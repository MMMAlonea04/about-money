// Trang "Hóa Đơn & Sổ Thông Tin" — lưu hóa đơn lẻ, chủ nhà, người bán hàng…
// Dữ liệu hoàn toàn tách biệt với sổ chi tiêu ở index.html.

const NB_STORAGE_KEY = "about_money_notebook_v1";
const NB_PIN_KEY = "about_money_saved_pin";

const state = {
  receipts: [],
  contacts: [],
  isApiMode: false,
  isAdmin: false,
  adminPin: "",
  activeTab: "nbReceipts",
  search: "",
  editingReceiptId: null,
  editingContactId: null,
  pendingReceiptBase64: null,
  removeReceipt: false
};

const el = {
  adminBanner: document.getElementById("adminBanner"),
  authToggle: document.getElementById("btnAuthToggle"),
  authIcon: document.getElementById("authIcon"),
  authLabel: document.getElementById("authLabel"),
  pinModal: document.getElementById("pinModal"),
  pinInput: document.getElementById("pinInput"),
  pinError: document.getElementById("pinError"),
  btnSubmitPin: document.getElementById("btnSubmitPin"),
  btnOpenAddReceipt: document.getElementById("btnOpenAddReceipt"),
  btnOpenAddContact: document.getElementById("btnOpenAddContact"),
  nbReceiptCount: document.getElementById("nbReceiptCount"),
  nbContactCount: document.getElementById("nbContactCount"),
  nbSummaryText: document.getElementById("nbSummaryText"),
  nbSearchInput: document.getElementById("nbSearchInput"),
  nbReceiptsList: document.getElementById("nbReceiptsList"),
  nbContactsList: document.getElementById("nbContactsList"),
  nbReceiptModal: document.getElementById("nbReceiptModal"),
  nbReceiptModalTitle: document.getElementById("nbReceiptModalTitle"),
  nbReceiptForm: document.getElementById("nbReceiptForm"),
  nbReceiptTitle: document.getElementById("nbReceiptTitle"),
  nbReceiptVendor: document.getElementById("nbReceiptVendor"),
  nbReceiptAmount: document.getElementById("nbReceiptAmount"),
  nbReceiptDate: document.getElementById("nbReceiptDate"),
  nbReceiptCategory: document.getElementById("nbReceiptCategory"),
  nbReceiptNote: document.getElementById("nbReceiptNote"),
  nbReceiptError: document.getElementById("nbReceiptError"),
  nbSaveReceipt: document.getElementById("nbSaveReceipt"),
  nbReceiptFileInput: document.getElementById("nbReceiptFileInput"),
  nbReceiptCameraInput: document.getElementById("nbReceiptCameraInput"),
  nbChooseGallery: document.getElementById("nbChooseGallery"),
  nbChooseCamera: document.getElementById("nbChooseCamera"),
  nbUploadPreview: document.getElementById("nbUploadPreview"),
  nbPreviewImage: document.getElementById("nbPreviewImage"),
  nbPreviewInfo: document.getElementById("nbPreviewInfo"),
  nbRemoveImage: document.getElementById("nbRemoveImage"),
  nbContactModal: document.getElementById("nbContactModal"),
  nbContactModalTitle: document.getElementById("nbContactModalTitle"),
  nbContactForm: document.getElementById("nbContactForm"),
  nbContactName: document.getElementById("nbContactName"),
  nbContactRole: document.getElementById("nbContactRole"),
  nbContactPhone: document.getElementById("nbContactPhone"),
  nbContactAddress: document.getElementById("nbContactAddress"),
  nbContactNote: document.getElementById("nbContactNote"),
  nbContactError: document.getElementById("nbContactError"),
  nbSaveContact: document.getElementById("nbSaveContact"),
  lightboxModal: document.getElementById("lightboxModal"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxTitle: document.getElementById("lightboxTitle"),
  lightboxDownload: document.getElementById("lightboxDownload"),
  lightboxClose: document.getElementById("lightboxClose"),
  toastContainer: document.getElementById("toastContainer")
};

// ---------- Helpers ----------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatVND(amount) {
  const value = Number(amount) || 0;
  const hasFraction = !Number.isInteger(value);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  }).format(value);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function parseOptionalAmount(rawValue) {
  const text = String(rawValue == null ? "" : rawValue).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
}

function showToast(message, duration = 3000) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function openModal(modal) {
  modal.classList.add("show");
}

function closeModal(modal) {
  modal.classList.remove("show");
}

function receiptSrcOf(item) {
  if (!item) return "";
  if (item.receiptId) return `/api/receipt?id=${item.receiptId}`;
  return item.receiptDataUrl || "";
}

async function compressImage(file, maxWidth = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          dataUrl,
          originalSizeKb: Math.round(file.size / 1024),
          compressedSizeKb: Math.round((dataUrl.length * 3) / 4 / 1024)
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showImage(src, title) {
  if (!src) return;
  el.lightboxImage.src = src;
  el.lightboxTitle.textContent = title || "Hóa đơn chi tiết";
  el.lightboxDownload.href = src;
  openModal(el.lightboxModal);
}

// ---------- Data ----------
async function loadNotebook() {
  try {
    const res = await fetch("/api/notebook");
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        state.isApiMode = true;
        state.receipts = Array.isArray(json.data.receipts) ? json.data.receipts : [];
        state.contacts = Array.isArray(json.data.contacts) ? json.data.contacts : [];
        renderAll();
        return;
      }
    }
  } catch (err) {
    console.info("Notebook API not reachable, using LocalStorage:", err.message);
  }

  state.isApiMode = false;
  try {
    const raw = localStorage.getItem(NB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.receipts = Array.isArray(parsed.receipts) ? parsed.receipts : [];
      state.contacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
    }
  } catch {
    state.receipts = [];
    state.contacts = [];
  }
  renderAll();
}

function saveLocalNotebook() {
  localStorage.setItem(
    NB_STORAGE_KEY,
    JSON.stringify({ receipts: state.receipts, contacts: state.contacts })
  );
}

// ---------- Auth ----------
function initAuth() {
  const savedPin = sessionStorage.getItem(NB_PIN_KEY);
  if (savedPin) {
    state.isAdmin = true;
    state.adminPin = savedPin;
  }
  updateAuthUi();
}

function setAdminLoggedIn(pin) {
  state.isAdmin = true;
  state.adminPin = pin;
  sessionStorage.setItem(NB_PIN_KEY, pin);
  closeModal(el.pinModal);
  updateAuthUi();
  renderAll();
  showToast("🔓 Đã mở khóa quyền Quản lý");
}

function logoutAdmin() {
  state.isAdmin = false;
  state.adminPin = "";
  sessionStorage.removeItem(NB_PIN_KEY);
  updateAuthUi();
  renderAll();
  showToast("🔒 Đã chuyển về chế độ chỉ xem");
}

async function unlockWithPin(pin) {
  if (state.isApiMode) {
    try {
      const res = await fetch("/api/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const json = await res.json();
      if (json.success && json.valid) {
        setAdminLoggedIn(pin);
        return true;
      }
      return false;
    } catch (err) {
      console.warn("PIN verification failed:", err);
    }
  }
  if (state.adminPin && pin === state.adminPin) {
    setAdminLoggedIn(pin);
    return true;
  }
  return false;
}

function updateAuthUi() {
  if (state.isAdmin) {
    el.authIcon.textContent = "🔓";
    el.authLabel.textContent = "Đăng xuất Quản lý";
    el.adminBanner.classList.remove("hidden");
    document.querySelectorAll(".admin-only").forEach((node) => node.classList.remove("hidden"));
  } else {
    el.authIcon.textContent = "🔒";
    el.authLabel.textContent = "Chế độ xem";
    el.adminBanner.classList.add("hidden");
    document.querySelectorAll(".admin-only").forEach((node) => node.classList.add("hidden"));
  }
}

// ---------- Render ----------
function filteredReceipts() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.receipts;
  return state.receipts.filter((item) =>
    [item.title, item.vendor, item.category, item.note].join(" ").toLowerCase().includes(q)
  );
}

function filteredContacts() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.contacts;
  return state.contacts.filter((item) =>
    [item.name, item.role, item.phone, item.address, item.note].join(" ").toLowerCase().includes(q)
  );
}

function renderCounts() {
  el.nbReceiptCount.textContent = state.receipts.length;
  el.nbContactCount.textContent = state.contacts.length;
  const total = state.receipts.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const totalText = total > 0 ? ` · tổng ${formatVND(total)}` : "";
  el.nbSummaryText.textContent = `${state.receipts.length} hóa đơn${totalText} · ${state.contacts.length} thông tin`;
}

function renderReceipts() {
  const items = filteredReceipts();
  if (items.length === 0) {
    el.nbReceiptsList.innerHTML = `
      <div class="nb-empty">
        <span class="empty-icon">🧾</span>
        <strong>${state.receipts.length ? "Không tìm thấy hóa đơn nào" : "Chưa có hóa đơn lẻ nào"}</strong>
        <span>Thêm hóa đơn mua sắm, bảo hành, giấy tờ… để lưu lại xem sau.</span>
      </div>`;
    return;
  }

  el.nbReceiptsList.innerHTML = items
    .map((item) => {
      const src = receiptSrcOf(item);
      return `
      <div class="card nb-receipt-card">
        <div class="nb-receipt-media${src ? "" : " nb-media-empty"}" onclick="openReceiptImage('${item.id}')" title="${src ? "Bấm để xem ảnh hóa đơn" : "Không có ảnh"}">
          ${src ? `<img src="${src}" alt="Hóa đơn" loading="lazy">` : `<span class="nb-no-img">🧾</span>`}
        </div>
        <div class="nb-receipt-body">
          <h3 class="nb-title">${escapeHtml(item.title || "Hóa đơn")}</h3>
          <div class="nb-meta">
            ${item.category ? `<span class="badge nb-badge">${escapeHtml(item.category)}</span>` : ""}
            ${item.date ? `<span>📅 ${formatDate(item.date)}</span>` : ""}
            ${item.amount != null ? `<span class="nb-amount">${formatVND(item.amount)}</span>` : ""}
          </div>
          ${item.vendor ? `<div class="nb-meta"><span>🏪 ${escapeHtml(item.vendor)}</span></div>` : ""}
          ${item.note ? `<p class="nb-note-text">"${escapeHtml(item.note)}"</p>` : ""}
          <div class="nb-actions">
            ${src ? `<button class="btn btn-sm btn-outline" onclick="openReceiptImage('${item.id}')">Xem ảnh</button>` : ""}
            ${
              state.isAdmin
                ? `<button class="btn btn-sm btn-outline" onclick="openEditReceipt('${item.id}')">✏️ Sửa</button>
                   <button class="btn btn-sm btn-danger" onclick="deleteReceipt('${item.id}')">Xóa</button>`
                : ""
            }
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function renderContacts() {
  const items = filteredContacts();
  if (items.length === 0) {
    el.nbContactsList.innerHTML = `
      <div class="nb-empty">
        <span class="empty-icon">👤</span>
        <strong>${state.contacts.length ? "Không tìm thấy thông tin nào" : "Sổ thông tin đang trống"}</strong>
        <span>Lưu thông tin chủ nhà, người bán hàng, thợ sửa… để tiện liên hệ.</span>
      </div>`;
    return;
  }

  el.nbContactsList.innerHTML = items
    .map((item) => {
      const initial = (item.name || "?").trim().charAt(0).toUpperCase();
      return `
      <div class="card nb-contact-card">
        <div class="nb-avatar">${escapeHtml(initial)}</div>
        <div class="nb-contact-body">
          <div class="nb-contact-head">
            <span class="nb-contact-name">${escapeHtml(item.name)}</span>
            ${item.role ? `<span class="nb-role">${escapeHtml(item.role)}</span>` : ""}
          </div>
          ${
            item.phone
              ? `<div class="nb-phone">📞 <a href="tel:${escapeHtml(item.phone.replace(/\s/g, ""))}">${escapeHtml(item.phone)}</a></div>`
              : ""
          }
          ${item.address ? `<div class="nb-address">📍 ${escapeHtml(item.address)}</div>` : ""}
          ${item.note ? `<p class="nb-note-text">"${escapeHtml(item.note)}"</p>` : ""}
          ${
            state.isAdmin
              ? `<div class="nb-actions">
                   <button class="btn btn-sm btn-outline" onclick="openEditContact('${item.id}')">✏️ Sửa</button>
                   <button class="btn btn-sm btn-danger" onclick="deleteContact('${item.id}')">Xóa</button>
                 </div>`
              : ""
          }
        </div>
      </div>`;
    })
    .join("");
}

function renderAll() {
  renderCounts();
  renderReceipts();
  renderContacts();
}

// ---------- Receipt modal ----------
function resetReceiptForm() {
  state.editingReceiptId = null;
  state.pendingReceiptBase64 = null;
  state.removeReceipt = false;
  el.nbReceiptModalTitle.textContent = "🧾 Thêm Hóa Đơn Lẻ";
  el.nbSaveReceipt.textContent = "Lưu Hóa Đơn";
  el.nbReceiptTitle.value = "";
  el.nbReceiptVendor.value = "";
  el.nbReceiptAmount.value = "";
  el.nbReceiptCategory.value = "";
  el.nbReceiptNote.value = "";
  el.nbReceiptDate.value = new Date().toISOString().split("T")[0];
  el.nbReceiptError.classList.add("hidden");
  el.nbReceiptError.textContent = "";
  el.nbReceiptFileInput.value = "";
  el.nbReceiptCameraInput.value = "";
  el.nbPreviewImage.src = "";
  el.nbUploadPreview.classList.add("hidden");
}

window.openReceiptImage = function (id) {
  const item = state.receipts.find((entry) => entry.id === id);
  if (!item) return;
  const src = receiptSrcOf(item);
  if (!src) {
    showToast("Hóa đơn này không đính kèm ảnh");
    return;
  }
  showImage(src, `${item.title || "Hóa đơn"}${item.amount != null ? " - " + formatVND(item.amount) : ""}`);
};

window.openEditReceipt = function (id) {
  const item = state.receipts.find((entry) => entry.id === id);
  if (!item) return;

  resetReceiptForm();
  state.editingReceiptId = item.id;
  el.nbReceiptModalTitle.textContent = "✏️ Sửa Hóa Đơn Lẻ";
  el.nbSaveReceipt.textContent = "Lưu Thay Đổi";
  el.nbReceiptTitle.value = item.title || "";
  el.nbReceiptVendor.value = item.vendor || "";
  el.nbReceiptAmount.value = item.amount != null ? String(item.amount) : "";
  el.nbReceiptDate.value = item.date || new Date().toISOString().split("T")[0];
  el.nbReceiptCategory.value = item.category || "";
  el.nbReceiptNote.value = item.note || "";

  const src = receiptSrcOf(item);
  if (src) {
    el.nbPreviewImage.src = src;
    el.nbPreviewInfo.textContent = "Ảnh hiện tại · chọn ảnh mới để thay thế";
    el.nbUploadPreview.classList.remove("hidden");
  }
  openModal(el.nbReceiptModal);
};

function collectReceiptPayload() {
  const amount = parseOptionalAmount(el.nbReceiptAmount.value);
  if (Number.isNaN(amount)) {
    el.nbReceiptError.textContent = "Số tiền không hợp lệ. Vui lòng nhập số lớn hơn hoặc bằng 0.";
    el.nbReceiptError.classList.remove("hidden");
    return null;
  }
  return {
    title: el.nbReceiptTitle.value.trim(),
    vendor: el.nbReceiptVendor.value.trim(),
    amount,
    date: el.nbReceiptDate.value,
    category: el.nbReceiptCategory.value.trim(),
    note: el.nbReceiptNote.value.trim(),
    receiptBase64: state.pendingReceiptBase64,
    removeReceipt: state.removeReceipt,
    pin: state.adminPin
  };
}

// ---------- Contact modal ----------
function resetContactForm() {
  state.editingContactId = null;
  el.nbContactModalTitle.textContent = "👤 Thêm Thông Tin";
  el.nbSaveContact.textContent = "Lưu Thông Tin";
  el.nbContactName.value = "";
  el.nbContactRole.value = "";
  el.nbContactPhone.value = "";
  el.nbContactAddress.value = "";
  el.nbContactNote.value = "";
  el.nbContactError.classList.add("hidden");
  el.nbContactError.textContent = "";
}

window.openEditContact = function (id) {
  const item = state.contacts.find((entry) => entry.id === id);
  if (!item) return;
  resetContactForm();
  state.editingContactId = item.id;
  el.nbContactModalTitle.textContent = "✏️ Sửa Thông Tin";
  el.nbSaveContact.textContent = "Lưu Thay Đổi";
  el.nbContactName.value = item.name || "";
  el.nbContactRole.value = item.role || "";
  el.nbContactPhone.value = item.phone || "";
  el.nbContactAddress.value = item.address || "";
  el.nbContactNote.value = item.note || "";
  openModal(el.nbContactModal);
};

// ---------- Mutations ----------
async function submitReceipt(e) {
  e.preventDefault();
  if (!state.isAdmin) {
    showToast("⚠️ Hãy mở khóa quyền Quản lý trước");
    return;
  }
  const payload = collectReceiptPayload();
  if (!payload) return;

  const isEditing = Boolean(state.editingReceiptId);
  el.nbSaveReceipt.disabled = true;
  el.nbSaveReceipt.textContent = "Đang lưu...";
  const defaultLabel = isEditing ? "Lưu Thay Đổi" : "Lưu Hóa Đơn";

  try {
    if (state.isApiMode) {
      const res = await fetch("/api/notebook/receipt", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-pin": state.adminPin },
        body: JSON.stringify({ ...payload, id: state.editingReceiptId || undefined })
      });
      const json = await res.json();
      if (!json.success) {
        el.nbReceiptError.textContent = json.error || "Không thể lưu hóa đơn";
        el.nbReceiptError.classList.remove("hidden");
        return;
      }
      state.receipts = json.data.receipts || state.receipts;
      state.contacts = json.data.contacts || state.contacts;
    } else if (isEditing) {
      const target = state.receipts.find((entry) => entry.id === state.editingReceiptId);
      if (!target) throw new Error("Không tìm thấy hóa đơn cần sửa");
      const newSrc = state.pendingReceiptBase64
        ? state.pendingReceiptBase64
        : state.removeReceipt
          ? null
          : target.receiptDataUrl || null;
      Object.assign(target, {
        title: payload.title || "Hóa đơn",
        vendor: payload.vendor,
        amount: payload.amount,
        date: payload.date,
        category: payload.category,
        note: payload.note,
        receiptId: null,
        receiptMime: null,
        receiptDataUrl: newSrc,
        updatedAt: new Date().toISOString()
      });
      saveLocalNotebook();
    } else {
      const now = new Date().toISOString();
      state.receipts.unshift({
        id: "nb_rcp_" + Date.now(),
        title: payload.title || "Hóa đơn",
        vendor: payload.vendor,
        amount: payload.amount,
        date: payload.date,
        category: payload.category,
        note: payload.note,
        receiptId: null,
        receiptMime: null,
        receiptDataUrl: state.pendingReceiptBase64,
        createdAt: now,
        updatedAt: now
      });
      saveLocalNotebook();
    }

    closeModal(el.nbReceiptModal);
    resetReceiptForm();
    renderAll();
    showToast(isEditing ? "✅ Đã cập nhật hóa đơn" : "✅ Đã lưu hóa đơn mới");
  } catch (err) {
    el.nbReceiptError.textContent = "Lỗi: " + err.message;
    el.nbReceiptError.classList.remove("hidden");
  } finally {
    el.nbSaveReceipt.disabled = false;
    el.nbSaveReceipt.textContent = state.editingReceiptId ? "Lưu Thay Đổi" : "Lưu Hóa Đơn";
  }
}

async function submitContact(e) {
  e.preventDefault();
  if (!state.isAdmin) {
    showToast("⚠️ Hãy mở khóa quyền Quản lý trước");
    return;
  }
  const name = el.nbContactName.value.trim();
  if (!name) {
    el.nbContactError.textContent = "Vui lòng nhập tên người / nơi lưu thông tin.";
    el.nbContactError.classList.remove("hidden");
    return;
  }

  const payload = {
    name,
    role: el.nbContactRole.value.trim(),
    phone: el.nbContactPhone.value.trim(),
    address: el.nbContactAddress.value.trim(),
    note: el.nbContactNote.value.trim(),
    pin: state.adminPin
  };
  const isEditing = Boolean(state.editingContactId);

  el.nbSaveContact.disabled = true;
  el.nbSaveContact.textContent = "Đang lưu...";
  const defaultLabel = isEditing ? "Lưu Thay Đổi" : "Lưu Thông Tin";

  try {
    if (state.isApiMode) {
      const res = await fetch("/api/notebook/contact", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-pin": state.adminPin },
        body: JSON.stringify({ ...payload, id: state.editingContactId || undefined })
      });
      const json = await res.json();
      if (!json.success) {
        el.nbContactError.textContent = json.error || "Không thể lưu thông tin";
        el.nbContactError.classList.remove("hidden");
        return;
      }
      state.receipts = json.data.receipts || state.receipts;
      state.contacts = json.data.contacts || state.contacts;
    } else if (isEditing) {
      const target = state.contacts.find((entry) => entry.id === state.editingContactId);
      if (!target) throw new Error("Không tìm thấy thông tin cần sửa");
      Object.assign(target, payload, { updatedAt: new Date().toISOString() });
      delete target.pin;
      saveLocalNotebook();
    } else {
      const now = new Date().toISOString();
      state.contacts.unshift({
        id: "nb_ct_" + Date.now(),
        name: payload.name,
        role: payload.role,
        phone: payload.phone,
        address: payload.address,
        note: payload.note,
        createdAt: now,
        updatedAt: now
      });
      saveLocalNotebook();
    }

    closeModal(el.nbContactModal);
    resetContactForm();
    renderAll();
    showToast(isEditing ? "✅ Đã cập nhật thông tin" : "✅ Đã lưu thông tin mới");
  } catch (err) {
    el.nbContactError.textContent = "Lỗi: " + err.message;
    el.nbContactError.classList.remove("hidden");
  } finally {
    el.nbSaveContact.disabled = false;
    el.nbSaveContact.textContent = state.editingContactId ? "Lưu Thay Đổi" : "Lưu Thông Tin";
  }
}

window.deleteReceipt = async function (id) {
  const item = state.receipts.find((entry) => entry.id === id);
  if (!item) return;
  if (!confirm(`Xóa hóa đơn "${item.title || "Hóa đơn"}" khỏi sổ?`)) return;

  try {
    if (state.isApiMode) {
      const res = await fetch(`/api/notebook/receipt?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-admin-pin": state.adminPin }
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || "Không thể xóa hóa đơn");
        return;
      }
      state.receipts = json.data.receipts || [];
      state.contacts = json.data.contacts || [];
    } else {
      state.receipts = state.receipts.filter((entry) => entry.id !== id);
      saveLocalNotebook();
    }
    renderAll();
    showToast("🗑️ Đã xóa hóa đơn");
  } catch (err) {
    alert("Lỗi khi xóa: " + err.message);
  }
};

window.deleteContact = async function (id) {
  const item = state.contacts.find((entry) => entry.id === id);
  if (!item) return;
  if (!confirm(`Xóa thông tin của "${item.name}"?`)) return;

  try {
    if (state.isApiMode) {
      const res = await fetch(`/api/notebook/contact?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-admin-pin": state.adminPin }
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || "Không thể xóa thông tin");
        return;
      }
      state.receipts = json.data.receipts || [];
      state.contacts = json.data.contacts || [];
    } else {
      state.contacts = state.contacts.filter((entry) => entry.id !== id);
      saveLocalNotebook();
    }
    renderAll();
    showToast("🗑️ Đã xóa thông tin");
  } catch (err) {
    alert("Lỗi khi xóa: " + err.message);
  }
};

// ---------- Receipt image picking ----------
async function processReceiptFile(file) {
  if (!file) return;
  try {
    showToast("⏳ Đang xử lý và tối ưu ảnh…");
    const result = await compressImage(file, 1280, 0.82);
    state.pendingReceiptBase64 = result.dataUrl;
    state.removeReceipt = false;
    el.nbPreviewImage.src = result.dataUrl;
    el.nbPreviewInfo.textContent = `${result.originalSizeKb} KB ➔ ${result.compressedSizeKb} KB (Đã tối ưu)`;
    el.nbUploadPreview.classList.remove("hidden");
  } catch (err) {
    alert("Không thể đọc ảnh: " + err.message);
  }
}

// ---------- Events ----------
function setupEvents() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      document.getElementById(target).classList.add("active");
      state.activeTab = target;
    });
  });

  // Modal close
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = document.getElementById(btn.getAttribute("data-close"));
      if (modal) closeModal(modal);
    });
  });

  // Lightbox
  el.lightboxClose.addEventListener("click", () => closeModal(el.lightboxModal));
  el.lightboxModal.addEventListener("click", (e) => {
    if (e.target === el.lightboxModal) closeModal(el.lightboxModal);
  });

  // Search
  el.nbSearchInput.addEventListener("input", (e) => {
    state.search = e.target.value;
    renderReceipts();
    renderContacts();
  });

  // Auth
  el.authToggle.addEventListener("click", () => {
    if (state.isAdmin) {
      if (confirm("Chuyển về chế độ chỉ xem?")) logoutAdmin();
    } else {
      el.pinInput.value = "";
      el.pinError.classList.add("hidden");
      openModal(el.pinModal);
      setTimeout(() => el.pinInput.focus(), 100);
    }
  });

  el.btnSubmitPin.addEventListener("click", async () => {
    const pin = el.pinInput.value.trim();
    if (!pin) {
      el.pinError.textContent = "Vui lòng nhập mật khẩu quản trị!";
      el.pinError.classList.remove("hidden");
      return;
    }
    el.btnSubmitPin.disabled = true;
    el.btnSubmitPin.textContent = "Đang kiểm tra...";
    const ok = await unlockWithPin(pin);
    el.btnSubmitPin.disabled = false;
    el.btnSubmitPin.textContent = "Mở Khóa Ngay";
    if (!ok) {
      el.pinError.textContent = "Mật khẩu không chính xác! Hãy kiểm tra biến ADMIN_PIN trên Netlify.";
      el.pinError.classList.remove("hidden");
    }
  });

  el.pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.btnSubmitPin.click();
  });

  // Add buttons
  el.btnOpenAddReceipt.addEventListener("click", () => {
    resetReceiptForm();
    openModal(el.nbReceiptModal);
  });

  el.btnOpenAddContact.addEventListener("click", () => {
    resetContactForm();
    openModal(el.nbContactModal);
  });

  // Receipt form
  el.nbReceiptForm.addEventListener("submit", submitReceipt);
  el.nbContactForm.addEventListener("submit", submitContact);

  // Image pickers
  el.nbChooseGallery.addEventListener("click", () => el.nbReceiptFileInput.click());
  el.nbChooseCamera.addEventListener("click", () => el.nbReceiptCameraInput.click());
  el.nbReceiptFileInput.addEventListener("change", (e) => processReceiptFile(e.target.files[0]));
  el.nbReceiptCameraInput.addEventListener("change", (e) => processReceiptFile(e.target.files[0]));

  el.nbRemoveImage.addEventListener("click", () => {
    state.pendingReceiptBase64 = null;
    state.removeReceipt = true;
    el.nbReceiptFileInput.value = "";
    el.nbReceiptCameraInput.value = "";
    el.nbPreviewImage.src = "";
    el.nbUploadPreview.classList.add("hidden");
    if (state.editingReceiptId) showToast("📌 Ảnh sẽ được gỡ khỏi hóa đơn này khi lưu");
  });
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  setupEvents();
  loadNotebook();
});
