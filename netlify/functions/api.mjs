import { getStore } from "@netlify/blobs";

function getAdminPin() {
  try {
    if (typeof Netlify !== "undefined" && Netlify?.env?.get) {
      const pin = Netlify.env.get("ADMIN_PIN");
      if (pin && String(pin).trim()) return String(pin).trim();
    }
  } catch {}
  if (typeof process !== "undefined" && process?.env?.ADMIN_PIN && String(process.env.ADMIN_PIN).trim()) {
    return String(process.env.ADMIN_PIN).trim();
  }
  return ""; // Tuyet doi khong dung 1234, chi dung dung bien moi truong ADMIN_PIN tren Netlify
}

function verifyPin(providedPin) {
  const configuredPin = getAdminPin();
  if (!configuredPin) {
    console.warn("Chưa cấu hình biến môi trường ADMIN_PIN trên Netlify!");
    return false;
  }
  const inputPin = String(providedPin || "").trim();
  return inputPin === configuredPin;
}

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

async function getDataStore() {
  return getStore("expense_data");
}

async function getReceiptStore() {
  return getStore("expense_receipts");
}

async function getNotebookStore() {
  return getStore("notebook_data");
}

async function loadNotebook() {
  try {
    const store = await getNotebookStore();
    const records = await store.get("records", { type: "json" });
    if (records && Array.isArray(records.receipts) && Array.isArray(records.contacts)) {
      return { receipts: records.receipts, contacts: records.contacts };
    }
  } catch (err) {
    console.warn("Could not read notebook from Netlify Blobs:", err.message);
  }
  return { receipts: [], contacts: [] };
}

async function saveNotebook(notebook) {
  const store = await getNotebookStore();
  await store.setJSON("records", notebook);
  return true;
}

async function deleteReceiptBlob(receiptId) {
  if (!receiptId) return;
  try {
    const receiptStore = await getReceiptStore();
    await receiptStore.delete(receiptId);
  } catch (err) {
    console.warn("Could not delete receipt blob:", err.message);
  }
}

// Lưu ảnh hóa đơn dạng base64 vào blob store, trả về id + mime type.
async function saveReceiptBase64(receiptBase64) {
  const receiptId = "rcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  const parts = String(receiptBase64).split(",");
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const receiptMime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const base64Data = parts.length > 1 ? parts[1] : parts[0];
  const buffer = Buffer.from(base64Data, "base64");

  const receiptStore = await getReceiptStore();
  await receiptStore.set(receiptId, buffer, {
    metadata: { mimeType: receiptMime }
  });
  return { receiptId, receiptMime };
}

// Chụp lại toàn bộ dữ liệu của khoản chi để lưu vào lịch sử chỉnh sửa.
function snapshotExpense(expense) {
  return {
    title: expense.title,
    amount: expense.amount,
    category: expense.category,
    date: expense.date,
    note: expense.note,
    receiptId: expense.receiptId || null,
    receiptMime: expense.receiptMime || null
  };
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

  // ================= SỔ HÓA ĐƠN & THÔNG TIN (trang riêng) =================

  // --- ROUTE: GET /notebook ---
  if (pathname === "/notebook" && req.method === "GET") {
    const data = await loadNotebook();
    return jsonResponse({ success: true, data });
  }

  // --- ROUTE: POST /notebook/receipt --- (Thêm hóa đơn lẻ)
  if (pathname === "/notebook/receipt" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Chỉ người quản lý mới có quyền thao tác." }, 401);
      }

      let amount = null;
      if (body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== "") {
        amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return jsonResponse({ success: false, error: "Số tiền không hợp lệ" }, 400);
        }
      }

      let receiptId = null;
      let receiptMime = null;
      if (body.receiptBase64 && typeof body.receiptBase64 === "string") {
        const saved = await saveReceiptBase64(body.receiptBase64);
        receiptId = saved.receiptId;
        receiptMime = saved.receiptMime;
      }

      const now = new Date().toISOString();
      const item = {
        id: "nb_rcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        title: String(body.title || "").trim() || "Hóa đơn",
        vendor: String(body.vendor || "").trim(),
        category: String(body.category || "").trim(),
        amount,
        date: body.date || now.split("T")[0],
        note: String(body.note || "").trim(),
        receiptId,
        receiptMime,
        createdAt: now,
        updatedAt: now
      };

      const notebook = await loadNotebook();
      notebook.receipts.unshift(item);
      await saveNotebook(notebook);

      return jsonResponse({ success: true, item, data: notebook });
    } catch (err) {
      console.error("Error adding notebook receipt:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: PUT /notebook/receipt --- (Sửa hóa đơn lẻ)
  if (pathname === "/notebook/receipt" && req.method === "PUT") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Chỉ người quản lý mới có quyền thao tác." }, 401);
      }

      const notebook = await loadNotebook();
      const target = notebook.receipts.find((item) => item.id === body.id);
      if (!target) {
        return jsonResponse({ success: false, error: "Không tìm thấy hóa đơn cần sửa" }, 404);
      }

      if (body.amount !== undefined) {
        if (body.amount === null || String(body.amount).trim() === "") {
          target.amount = null;
        } else {
          const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount < 0) {
            return jsonResponse({ success: false, error: "Số tiền không hợp lệ" }, 400);
          }
          target.amount = amount;
        }
      }

      if (body.title !== undefined) target.title = String(body.title || "").trim() || "Hóa đơn";
      if (body.vendor !== undefined) target.vendor = String(body.vendor || "").trim();
      if (body.category !== undefined) target.category = String(body.category || "").trim();
      if (body.note !== undefined) target.note = String(body.note || "").trim();
      if (body.date) target.date = body.date;

      if (body.receiptBase64 && typeof body.receiptBase64 === "string") {
        const oldReceiptId = target.receiptId;
        const saved = await saveReceiptBase64(body.receiptBase64);
        target.receiptId = saved.receiptId;
        target.receiptMime = saved.receiptMime;
        if (oldReceiptId && oldReceiptId !== target.receiptId) await deleteReceiptBlob(oldReceiptId);
      } else if (body.removeReceipt) {
        await deleteReceiptBlob(target.receiptId);
        target.receiptId = null;
        target.receiptMime = null;
      }

      target.updatedAt = new Date().toISOString();
      await saveNotebook(notebook);

      return jsonResponse({ success: true, item: target, data: notebook });
    } catch (err) {
      console.error("Error updating notebook receipt:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: DELETE /notebook/receipt ---
  if (pathname === "/notebook/receipt" && req.method === "DELETE") {
    try {
      if (!checkAuth()) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng mở khóa trước." }, 401);
      }
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ success: false, error: "Thiếu ID hóa đơn" }, 400);

      const notebook = await loadNotebook();
      const target = notebook.receipts.find((item) => item.id === id);
      if (!target) {
        return jsonResponse({ success: false, error: "Không tìm thấy hóa đơn" }, 404);
      }

      await deleteReceiptBlob(target.receiptId);
      notebook.receipts = notebook.receipts.filter((item) => item.id !== id);
      await saveNotebook(notebook);

      return jsonResponse({ success: true, data: notebook });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: POST /notebook/contact --- (Thêm thông tin)
  if (pathname === "/notebook/contact" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Chỉ người quản lý mới có quyền thao tác." }, 401);
      }

      const name = String(body.name || "").trim();
      if (!name) {
        return jsonResponse({ success: false, error: "Vui lòng nhập tên người / nơi lưu thông tin" }, 400);
      }

      const now = new Date().toISOString();
      const item = {
        id: "nb_ct_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        name,
        role: String(body.role || "").trim(),
        phone: String(body.phone || "").trim(),
        address: String(body.address || "").trim(),
        note: String(body.note || "").trim(),
        createdAt: now,
        updatedAt: now
      };

      const notebook = await loadNotebook();
      notebook.contacts.unshift(item);
      await saveNotebook(notebook);

      return jsonResponse({ success: true, item, data: notebook });
    } catch (err) {
      console.error("Error adding notebook contact:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: PUT /notebook/contact ---
  if (pathname === "/notebook/contact" && req.method === "PUT") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Chỉ người quản lý mới có quyền thao tác." }, 401);
      }

      const notebook = await loadNotebook();
      const target = notebook.contacts.find((item) => item.id === body.id);
      if (!target) {
        return jsonResponse({ success: false, error: "Không tìm thấy thông tin cần sửa" }, 404);
      }

      if (body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (!name) {
          return jsonResponse({ success: false, error: "Vui lòng nhập tên người / nơi lưu thông tin" }, 400);
        }
        target.name = name;
      }
      if (body.role !== undefined) target.role = String(body.role || "").trim();
      if (body.phone !== undefined) target.phone = String(body.phone || "").trim();
      if (body.address !== undefined) target.address = String(body.address || "").trim();
      if (body.note !== undefined) target.note = String(body.note || "").trim();
      target.updatedAt = new Date().toISOString();

      await saveNotebook(notebook);
      return jsonResponse({ success: true, item: target, data: notebook });
    } catch (err) {
      console.error("Error updating notebook contact:", err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // --- ROUTE: DELETE /notebook/contact ---
  if (pathname === "/notebook/contact" && req.method === "DELETE") {
    try {
      if (!checkAuth()) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng mở khóa trước." }, 401);
      }
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse({ success: false, error: "Thiếu ID thông tin" }, 400);

      const notebook = await loadNotebook();
      notebook.contacts = notebook.contacts.filter((item) => item.id !== id);
      await saveNotebook(notebook);

      return jsonResponse({ success: true, data: notebook });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
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

  // --- ROUTE: PUT /expense --- (Edit an expense, only once per expense)
  if (pathname === "/expense" && req.method === "PUT") {
    try {
      const body = await req.json();
      if (!checkAuth(body.pin)) {
        return jsonResponse({ success: false, error: "Mã PIN không đúng! Vui lòng nhập lại mã PIN." }, 401);
      }

      const id = String(body.id || "");
      if (!id) {
        return jsonResponse({ success: false, error: "Thiếu ID khoản chi" }, 400);
      }

      const title = String(body.title || "").trim();
      const amount = Number(body.amount);
      if (!title) {
        return jsonResponse({ success: false, error: "Vui lòng nhập tên khoản chi" }, 400);
      }
      if (!amount || isNaN(amount) || amount <= 0) {
        return jsonResponse({ success: false, error: "Số tiền chi tiêu không hợp lệ" }, 400);
      }

      const current = await loadData();
      const index = current.expenses.findIndex((exp) => exp.id === id);
      if (index === -1) {
        return jsonResponse({ success: false, error: "Không tìm thấy khoản chi cần sửa" }, 404);
      }

      const expense = current.expenses[index];
      const editCount = Number(expense.editCount || (expense.editedAt ? 1 : 0));
      if (editCount >= 1) {
        return jsonResponse(
          { success: false, error: "Khoản chi này đã được sửa 1 lần. Mỗi khoản chi chỉ được sửa duy nhất 1 lần." },
          409
        );
      }

      const before = snapshotExpense(expense);

      let receiptId = expense.receiptId || null;
      let receiptMime = expense.receiptMime || null;
      if (body.receiptBase64 && typeof body.receiptBase64 === "string") {
        const saved = await saveReceiptBase64(body.receiptBase64);
        receiptId = saved.receiptId;
        receiptMime = saved.receiptMime;
      } else if (body.removeReceipt) {
        receiptId = null;
        receiptMime = null;
      }

      const editedAt = new Date().toISOString();
      const after = {
        title,
        amount,
        category: body.category || expense.category || "Khác",
        date: body.date || expense.date,
        note: String(body.note || "").trim(),
        receiptId,
        receiptMime
      };

      expense.title = after.title;
      expense.amount = after.amount;
      expense.category = after.category;
      expense.date = after.date;
      expense.note = after.note;
      expense.receiptId = receiptId;
      expense.receiptMime = receiptMime;
      expense.editCount = 1;
      expense.editedAt = editedAt;
      expense.editHistory = Array.isArray(expense.editHistory) ? expense.editHistory : [];
      // Ảnh hóa đơn cũ vẫn được giữ nguyên trong blob store để xem lại ở lịch sử chỉnh sửa.
      expense.editHistory.push({ editedAt, before, after });

      current.expenses[index] = expense;
      await saveData(current);

      return jsonResponse({ success: true, item: expense, data: current });
    } catch (err) {
      console.error("Error updating expense:", err);
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

      if (targetExpense) {
        // Xóa cả ảnh hóa đơn hiện tại và ảnh cũ đã lưu trong lịch sử chỉnh sửa.
        const receiptIds = new Set();
        if (targetExpense.receiptId) receiptIds.add(targetExpense.receiptId);
        (targetExpense.editHistory || []).forEach((entry) => {
          if (entry?.before?.receiptId) receiptIds.add(entry.before.receiptId);
          if (entry?.after?.receiptId) receiptIds.add(entry.after.receiptId);
        });

        try {
          const receiptStore = await getReceiptStore();
          for (const receiptId of receiptIds) {
            await receiptStore.delete(receiptId);
          }
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
