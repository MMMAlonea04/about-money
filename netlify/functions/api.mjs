import { getStore } from "@netlify/blobs";

// Default PIN if environment variable is not defined
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

const DEFAULT_CATEGORIES = [
  "Ăn uống",
  "Tiền nhà / Điện nước",
  "Học tập",
  "Di chuyển / Xăng xe",
  "Y tế / Cá nhân",
  "Khác"
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-pin"
    }
  });
}

function verifyPin(providedPin) {
  return String(providedPin || "").trim() === String(ADMIN_PIN).trim();
}

async function getDataStore() {
  return getStore("expense_data");
}

async function getReceiptStore() {
  return getStore("expense_receipts");
}

async function loadData() {
  try {
    const store = await getDataStore();
    const records = await store.get("records", { type: "json" });
    if (records && Array.isArray(records.expenses) && Array.isArray(records.allowances)) {
      return records;
    }
  } catch (err) {
    console.warn("Could not read from Netlify Blobs (using empty memory store):", err.message);
  }
  return {
    allowances: [],
    expenses: []
  };
}

async function saveData(data) {
  try {
    const store = await getDataStore();
    await store.setJSON("records", data);
    return true;
  } catch (err) {
    console.error("Failed to save to Netlify Blobs:", err);
    throw new Error("Không thể lưu trữ vào Netlify Blobs: " + err.message);
  }
}

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-admin-pin"
      }
    });
  }

  const url = new URL(req.url);
  // Match subpath after /api or /.netlify/functions/api
  let pathname = url.pathname;
  if (pathname.startsWith("/.netlify/functions/api")) {
    pathname = pathname.replace("/.netlify/functions/api", "");
  } else if (pathname.startsWith("/api")) {
    pathname = pathname.replace("/api", "");
  }
  if (!pathname || pathname === "") pathname = "/";

  const pinHeader = req.headers.get("x-admin-pin");

  // --- ROUTE: GET /receipt ---
  if (pathname === "/receipt" && req.method === "GET") {
    const receiptId = url.searchParams.get("id");
    if (!receiptId) {
      return new Response("Missing receipt ID", { status: 400 });
    }
    try {
      const receiptStore = await getReceiptStore();
      const meta = await receiptStore.getMetadata(receiptId);
      const mimeType = meta?.metadata?.mimeType || "image/jpeg";
      const blobData = await receiptStore.get(receiptId, { type: "arrayBuffer" });

      if (!blobData) {
        return new Response("Receipt not found", { status: 404 });
      }

      return new Response(blobData, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=604800, immutable",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      console.error("Error reading receipt:", err);
      return new Response("Error retrieving receipt: " + err.message, { status: 500 });
    }
  }

  // --- ROUTE: GET /data ---
  if ((pathname === "/" || pathname === "/data") && req.method === "GET") {
    const data = await loadData();
    return jsonResponse({
      success: true,
      data,
      categories: DEFAULT_CATEGORIES
    });
  }

  // --- ROUTE: POST /verify-pin ---
  if (pathname === "/verify-pin" && req.method === "POST") {
    try {
      const body = await req.json();
      const isValid = verifyPin(body.pin);
      return jsonResponse({ success: isValid, valid: isValid });
    } catch {
      return jsonResponse({ success: false, error: "Dữ liệu không hợp lệ" }, 400);
    }
  }

  // PIN check for mutation operations
  function checkAuth(reqBodyPin) {
    const pin = pinHeader || reqBodyPin;
    if (!verifyPin(pin)) {
      return false;
    }
    return true;
  }

  // --- ROUTE: POST /reset --- (Reset all records)
  if (pathname === "/reset" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng nhập đúng mã PIN." }, 401);
      }
      await saveData({ allowances: [], expenses: [] });
      return jsonResponse({ success: true, message: "Đã xóa toàn bộ dữ liệu thành công" });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: POST /allowance --- (Add allowance from Mom)
  if (pathname === "/allowance" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Chỉ người quản lý mới có quyền thao tác." }, 401);
      }

      const amount = Number(body.amount);
      if (!amount || isNaN(amount) || amount <= 0) {
        return jsonResponse({ success: false, error: "Số tiền trợ cấp không hợp lệ" }, 400);
      }

      const newAllowance = {
        id: "alw_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        amount,
        date: body.date || new Date().toISOString().split("T")[0],
        note: body.note ? String(body.note).trim() : "Mẹ gửi tiền trợ cấp",
        createdAt: new Date().toISOString()
      };

      const current = await loadData();
      current.allowances.unshift(newAllowance);
      await saveData(current);

      return jsonResponse({ success: true, item: newAllowance, data: current });
    } catch (err) {
      console.error("Error adding allowance:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: DELETE /allowance ---
  if (pathname === "/allowance" && req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!checkAuth()) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng mở khóa trước." }, 401);
      }
      if (!id) return jsonResponse({ success: false, error: "Thiếu ID đợt trợ cấp" }, 400);

      const current = await loadData();
      current.allowances = current.allowances.filter((item) => item.id !== id);
      await saveData(current);

      return jsonResponse({ success: true, data: current });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: POST /expense --- (Add expense with optional receipt)
  if (pathname === "/expense" && req.method === "POST") {
    try {
      let body;
      const contentType = req.headers.get("content-type") || "";

      let receiptId = null;
      let receiptMime = null;
      let title = "";
      let amount = 0;
      let category = "Khác";
      let date = new Date().toISOString().split("T")[0];
      let note = "";
      let pin = "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        title = formData.get("title");
        amount = Number(formData.get("amount"));
        category = formData.get("category") || "Khác";
        date = formData.get("date") || date;
        note = formData.get("note") || "";
        pin = formData.get("pin");

        const file = formData.get("receipt");
        if (file && typeof file === "object" && file.size > 0) {
          receiptId = "rcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
          receiptMime = file.type || "image/jpeg";
          const receiptStore = await getReceiptStore();
          const buffer = await file.arrayBuffer();
          await receiptStore.set(receiptId, buffer, {
            metadata: { mimeType: receiptMime, fileName: file.name || "receipt.jpg" }
          });
        }
      } else {
        body = await req.json();
        title = body.title;
        amount = Number(body.amount);
        category = body.category || "Khác";
        date = body.date || date;
        note = body.note || "";
        pin = body.pin;

        // If base64 receipt is sent
        if (body.receiptBase64 && typeof body.receiptBase64 === "string") {
          receiptId = "rcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
          const parts = body.receiptBase64.split(",");
          let mimeMatch = parts[0]?.match(/:(.*?);/);
          receiptMime = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const base64Data = parts.length > 1 ? parts[1] : parts[0];
          const buffer = Buffer.from(base64Data, "base64");

          const receiptStore = await getReceiptStore();
          await receiptStore.set(receiptId, buffer, {
            metadata: { mimeType: receiptMime }
          });
        }
      }

      if (!checkAuth(pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng nhập lại mã PIN." }, 401);
      }

      if (!title || !title.trim()) {
        return jsonResponse({ success: false, error: "Vui lòng nhập tên khoản chi" }, 400);
      }
      if (!amount || isNaN(amount) || amount <= 0) {
        return jsonResponse({ success: false, error: "Số tiền chi tiêu không hợp lệ" }, 400);
      }

      const newExpense = {
        id: "exp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        title: title.trim(),
        amount,
        category,
        date,
        note: note.trim(),
        receiptId,
        receiptMime,
        createdAt: new Date().toISOString()
      };

      const current = await loadData();
      current.expenses.unshift(newExpense);
      await saveData(current);

      return jsonResponse({ success: true, item: newExpense, data: current });
    } catch (err) {
      console.error("Error creating expense:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: DELETE /expense ---
  if (pathname === "/expense" && req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!checkAuth()) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng mở khóa trước." }, 401);
      }
      if (!id) return jsonResponse({ success: false, error: "Thiếu ID khoản chi" }, 400);

      const current = await loadData();
      const targetExpense = current.expenses.find((exp) => exp.id === id);

      if (targetExpense && targetExpense.receiptId) {
        try {
          const receiptStore = await getReceiptStore();
          await receiptStore.delete(targetExpense.receiptId);
        } catch (err) {
          console.warn("Could not delete receipt blob:", err.message);
        }
      }

      current.expenses = current.expenses.filter((exp) => exp.id !== id);
      await saveData(current);

      return jsonResponse({ success: true, data: current });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  return jsonResponse({ error: "Endpoint not found" }, 404);
};

export const config = {
  path: "/api/*"
};
