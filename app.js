// Sổ Chi Tiêu & Hóa Đơn Trợ Cấp - Client Application

const STORAGE_KEY_DATA = "about_money_local_data_v1";
const STORAGE_KEY_PIN = "about_money_saved_pin";
const AMOUNT_HINT_DEFAULT = "Có thể nhập số lẻ tùy ý, ví dụ 57.650 ₫.";

// App State
let state = {
  allowances: [],
  expenses: [],
  categories: [
    "Ăn uống",
    "Tiền nhà / Điện nước",
    "Học tập",
    "Di chuyển / Xăng xe",
    "Y tế / Cá nhân",
    "Khác"
  ],
  isAdmin: false,
  adminPin: "",
  activeTab: "tabExpenses",
  filters: {
    search: "",
    month: "all",
    category: "all",
    onlyReceipts: false
  },
  pendingReceiptBase64: null,
  editingExpenseId: null,
  removeReceipt: false,
  isApiMode: false
};

// Initial Data if blank
const INITIAL_DEMO_DATA = {
  allowances: [],
  expenses: []
};

// Generate a tiny placeholder SVG for demo receipts
function createDemoReceiptSvg(title, price, date) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
    <rect width="100%" height="100%" fill="#ffffff" stroke="#cbd5e1" stroke-width="3"/>
    <rect x="0" y="0" width="100%" height="12" fill="#4f46e5"/>
    <text x="150" y="55" font-family="sans-serif" font-weight="bold" font-size="18" fill="#1e293b" text-anchor="middle">${title}</text>
    <text x="150" y="80" font-family="sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Ngày: ${date}</text>
    <line x1="25" y1="100" x2="275" y2="100" stroke="#94a3b8" stroke-dasharray="4"/>
    <text x="30" y="140" font-family="sans-serif" font-size="14" fill="#334155">Mặt hàng chi tiết:</text>
    <text x="30" y="175" font-family="sans-serif" font-size="13" fill="#475569">• Khoản chi tiêu thực tế</text>
    <text x="30" y="205" font-family="sans-serif" font-size="13" fill="#475569">• Đã thanh toán đầy đủ</text>
    <line x1="25" y1="240" x2="275" y2="240" stroke="#94a3b8" stroke-dasharray="4"/>
    <text x="30" y="280" font-family="sans-serif" font-weight="bold" font-size="16" fill="#0f172a">TỔNG CỘNG:</text>
    <text x="270" y="280" font-family="sans-serif" font-weight="bold" font-size="18" fill="#dc2626" text-anchor="end">${price}</text>
    <rect x="70" y="325" width="160" height="40" fill="#f1f5f9" rx="6"/>
    <text x="150" y="350" font-family="sans-serif" font-size="12" fill="#059669" font-weight="bold" text-anchor="middle">✓ ĐÃ ĐỐI SOÁT HỢP LỆ</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Format currency in Vietnamese Dong
// Số tiền lẻ (có phần thập phân) được hiển thị đủ 2 chữ số sau dấu phẩy,
// số tiền chẵn vẫn hiển thị gọn như cũ.
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

// Đọc số tiền người dùng nhập: chấp nhận mọi số dương, kể cả số lẻ.
function parseAmount(rawValue) {
  const raw = String(rawValue == null ? "" : rawValue).trim().replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Hiển thị ngay số tiền vừa nhập theo định dạng Việt Nam để người dùng kiểm tra lại.
function syncAmountHint(input, hint, fallbackText) {
  if (!input || !hint) return () => {};
  const sync = () => {
    const value = parseAmount(input.value);
    if (value == null) {
      hint.textContent = fallbackText;
      hint.classList.remove("text-emerald");
      return;
    }
    hint.textContent = `≈ ${formatVND(value)}`;
    hint.classList.add("text-emerald");
  };
  input.addEventListener("input", sync);
  input.addEventListener("blur", sync);
  return sync;
}

// Dán số tiền kiểu "57.650 đ" / "1.500.000": bỏ dấu phân cách nghìn để không bị hiểu nhầm.
function handleAmountPaste(e) {
  const clipboard = e.clipboardData || window.clipboardData;
  if (!clipboard) return;
  const numeric = String(clipboard.getData("text") || "").replace(/[^\d.,]/g, "");
  if (!/^\d{1,3}([.,]\d{3})+$/.test(numeric)) return;
  e.preventDefault();
  e.target.value = numeric.replace(/[.,]/g, "");
  e.target.dispatchEvent(new Event("input", { bubbles: true }));
}

// Format Date for Vietnamese display
function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// Format Date + time (for edit history)
function formatDateTime(isoStr) {
  if (!isoStr) return "";
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(isoStr.slice(0, 10))} ${hh}:${mm}`;
}

// Đường dẫn ảnh hóa đơn của một khoản chi (hoặc của bản ghi cũ trong lịch sử)
function receiptSrcOf(item) {
  if (!item) return "";
  if (item.receiptId) return `/api/receipt?id=${item.receiptId}`;
  return item.receiptDataUrl || "";
}

// Chụp lại dữ liệu khoản chi trước khi sửa để lưu vào lịch sử chỉnh sửa.
function snapshotExpense(exp) {
  return {
    title: exp.title,
    amount: exp.amount,
    category: exp.category,
    date: exp.date,
    note: exp.note,
    receiptId: exp.receiptId || null,
    receiptMime: exp.receiptMime || null,
    receiptDataUrl: exp.receiptDataUrl || null
  };
}

// DOM Elements
const el = {
  totalAllowance: document.getElementById("totalAllowance"),
  allowanceCount: document.getElementById("allowanceCount"),
  totalExpense: document.getElementById("totalExpense"),
  expenseCount: document.getElementById("expenseCount"),
  balanceAmount: document.getElementById("balanceAmount"),
  balanceStatus: document.getElementById("balanceStatus"),
  categoryBars: document.getElementById("categoryBars"),
  categoryStatsSummary: document.getElementById("categoryStatsSummary"),
  tabExpenseCount: document.getElementById("tabExpenseCount"),
  tabAllowanceCount: document.getElementById("tabAllowanceCount"),
  tabEditHistoryCount: document.getElementById("tabEditHistoryCount"),
  editHistorySummary: document.getElementById("editHistorySummary"),
  editHistoryList: document.getElementById("editHistoryList"),
  editHistoryModal: document.getElementById("editHistoryModal"),
  editHistoryBody: document.getElementById("editHistoryBody"),
  expensesList: document.getElementById("expensesList"),
  allowancesList: document.getElementById("allowancesList"),
  searchInput: document.getElementById("searchInput"),
  monthFilter: document.getElementById("monthFilter"),
  categoryFilter: document.getElementById("categoryFilter"),
  onlyReceiptsFilter: document.getElementById("onlyReceiptsFilter"),
  adminBanner: document.getElementById("adminBanner"),
  authToggle: document.getElementById("btnAuthToggle"),
  authIcon: document.getElementById("authIcon"),
  authLabel: document.getElementById("authLabel"),
  pinModal: document.getElementById("pinModal"),
  pinInput: document.getElementById("pinInput"),
  pinError: document.getElementById("pinError"),
  btnSubmitPin: document.getElementById("btnSubmitPin"),
  addExpenseModal: document.getElementById("addExpenseModal"),
  addExpenseForm: document.getElementById("addExpenseForm"),
  expenseModalTitle: document.getElementById("expenseModalTitle"),
  editNotice: document.getElementById("editNotice"),
  expenseTitle: document.getElementById("expenseTitle"),
  expenseAmount: document.getElementById("expenseAmount"),
  expenseAmountHint: document.getElementById("expenseAmountHint"),
  expenseCategory: document.getElementById("expenseCategory"),
  expenseDate: document.getElementById("expenseDate"),
  expenseNote: document.getElementById("expenseNote"),
  receiptFileInput: document.getElementById("receiptFileInput"),
  receiptCameraInput: document.getElementById("receiptCameraInput"),
  btnChooseGallery: document.getElementById("btnChooseGallery"),
  btnChooseCamera: document.getElementById("btnChooseCamera"),
  uploadPreview: document.getElementById("uploadPreview"),
  previewImage: document.getElementById("previewImage"),
  previewInfo: document.getElementById("previewInfo"),
  btnRemoveImage: document.getElementById("btnRemoveImage"),
  btnOpenAddExpense: document.getElementById("btnOpenAddExpense"),
  btnOpenAddAllowance: document.getElementById("btnOpenAddAllowance"),
  btnTabAddAllowance: document.getElementById("btnTabAddAllowance"),
  addAllowanceModal: document.getElementById("addAllowanceModal"),
  addAllowanceForm: document.getElementById("addAllowanceForm"),
  allowanceAmount: document.getElementById("allowanceAmount"),
  allowanceAmountHint: document.getElementById("allowanceAmountHint"),
  allowanceDate: document.getElementById("allowanceDate"),
  allowanceNote: document.getElementById("allowanceNote"),
  lightboxModal: document.getElementById("lightboxModal"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxTitle: document.getElementById("lightboxTitle"),
  lightboxDownload: document.getElementById("lightboxDownload"),
  lightboxClose: document.getElementById("lightboxClose"),
  btnResetAllData: document.getElementById("btnResetAllData"),
  btnShareSummary: document.getElementById("btnShareSummary"),
  toastContainer: document.getElementById("toastContainer")
};

// Toast notification helper
function showToast(message, duration = 3000) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Image compression via Canvas (resizes large phone photos to max 1280px & optimizes)
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
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const originalSizeKb = Math.round(file.size / 1024);
        const compressedSizeKb = Math.round((dataUrl.length * 3) / 4 / 1024);

        resolve({
          dataUrl,
          originalSizeKb,
          compressedSizeKb
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Load data from Backend API or fallback to LocalStorage
async function loadAppData() {
  try {
    const res = await fetch("/api/data");
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        state.isApiMode = true;
        state.allowances = json.data.allowances || [];
        state.expenses = json.data.expenses || [];
        if (json.categories) state.categories = json.categories;
        renderAll();
        return;
      }
    }
  } catch (err) {
    console.info("API not reachable, using LocalStorage mode:", err.message);
  }

  // Fallback to LocalStorage
  state.isApiMode = false;
  const local = localStorage.getItem(STORAGE_KEY_DATA);
  if (local) {
    try {
      const parsed = JSON.parse(local);
      state.allowances = parsed.allowances || [];
      state.expenses = parsed.expenses || [];
    } catch {
      state.allowances = INITIAL_DEMO_DATA.allowances;
      state.expenses = INITIAL_DEMO_DATA.expenses;
    }
  } else {
    // Seed initial demo data
    state.allowances = INITIAL_DEMO_DATA.allowances;
    state.expenses = INITIAL_DEMO_DATA.expenses;
    saveLocalData();
  }
  renderAll();
}

function saveLocalData() {
  localStorage.setItem(
    STORAGE_KEY_DATA,
    JSON.stringify({
      allowances: state.allowances,
      expenses: state.expenses
    })
  );
}

// Authentication & PIN handling
function initAuth() {
  const savedPin = sessionStorage.getItem(STORAGE_KEY_PIN);
  if (savedPin) {
    state.isAdmin = true;
    state.adminPin = savedPin;
    updateAuthUi();
  }
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
      console.warn("Backend pin verification failed:", err);
    }
  }

  // Khong co mat khau 1234 mac dinh, chi chap nhan mat khau qua API hoac da luu truoc do
  if (state.adminPin && pin === state.adminPin) {
    setAdminLoggedIn(pin);
    return true;
  }
  return false;
}

function setAdminLoggedIn(pin) {
  state.isAdmin = true;
  state.adminPin = pin;
  sessionStorage.setItem(STORAGE_KEY_PIN, pin);
  updateAuthUi();
  closeModal(el.pinModal);
  showToast("🔓 Đã mở khóa quyền Quản lý chi tiêu!");
  renderExpenses();
  renderAllowances();
}

function logoutAdmin() {
  state.isAdmin = false;
  state.adminPin = "";
  sessionStorage.removeItem(STORAGE_KEY_PIN);
  updateAuthUi();
  showToast("🔒 Đã chuyển về chế độ chỉ xem");
  renderExpenses();
  renderAllowances();
}

function updateAuthUi() {
  if (state.isAdmin) {
    el.authIcon.textContent = "🔓";
    el.authLabel.textContent = "Đăng xuất Quản lý";
    el.adminBanner.classList.remove("hidden");
    document.querySelectorAll(".admin-only").forEach((elem) => elem.classList.remove("hidden"));
  } else {
    el.authIcon.textContent = "🔒";
    el.authLabel.textContent = "Chế độ xem (Mẹ)";
    el.adminBanner.classList.add("hidden");
    document.querySelectorAll(".admin-only").forEach((elem) => elem.classList.add("hidden"));
  }
}

// Render Totals & Overview Stats
function renderSummary() {
  const totalAllow = state.allowances.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
  const totalExp = state.expenses.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
  const balance = totalAllow - totalExp;

  const receiptCount = state.expenses.filter((e) => e.receiptId || e.receiptDataUrl).length;

  el.totalAllowance.textContent = formatVND(totalAllow);
  el.allowanceCount.textContent = `${state.allowances.length} đợt nhận tiền trợ cấp`;

  el.totalExpense.textContent = formatVND(totalExp);
  el.expenseCount.textContent = `${state.expenses.length} khoản chi (${receiptCount} có ảnh hóa đơn)`;

  el.balanceAmount.textContent = formatVND(balance);

  if (balance > 1000000) {
    el.balanceAmount.className = "stat-value text-emerald";
    el.balanceStatus.innerHTML = "✅ Số dư còn khá thoải mái";
  } else if (balance >= 0) {
    el.balanceAmount.className = "stat-value text-amber";
    el.balanceStatus.innerHTML = "⚠️ Số dư còn ít, cần tiết kiệm";
  } else {
    el.balanceAmount.className = "stat-value text-danger";
    el.balanceStatus.innerHTML = "🚨 Đã chi vượt mức trợ cấp!";
  }

  el.tabExpenseCount.textContent = state.expenses.length;
  el.tabAllowanceCount.textContent = state.allowances.length;

  const totalEdits = state.expenses.reduce(
    (acc, exp) => acc + (Array.isArray(exp.editHistory) ? exp.editHistory.length : 0),
    0
  );
  el.tabEditHistoryCount.textContent = totalEdits;
  el.editHistorySummary.textContent = `${totalEdits} lần sửa trên ${state.expenses.filter((e) => (e.editHistory || []).length).length} khoản chi`;

  renderCategoryBreakdown(totalExp);
}

// Render Category Breakdown Bars
function renderCategoryBreakdown(totalExpense) {
  if (!totalExpense || totalExpense <= 0) {
    el.categoryBars.innerHTML = `<p class="text-muted" style="font-size:0.9rem">Chưa có dữ liệu chi tiêu</p>`;
    el.categoryStatsSummary.textContent = "0 danh mục";
    return;
  }

  const categoryTotals = {};
  state.categories.forEach((cat) => (categoryTotals[cat] = 0));

  state.expenses.forEach((exp) => {
    const cat = exp.category || "Khác";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(exp.amount) || 0);
  });

  const activeCategories = Object.entries(categoryTotals)
    .filter(([_, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

  el.categoryStatsSummary.textContent = `${activeCategories.length} nhóm đã phát sinh chi`;

  const palette = ["#4f46e5", "#059669", "#d97706", "#dc2626", "#8b5cf6", "#06b6d4"];

  el.categoryBars.innerHTML = activeCategories
    .map(([cat, amt], idx) => {
      const pct = Math.round((amt / totalExpense) * 100);
      const color = palette[idx % palette.length];
      return `
      <div class="cat-bar-item">
        <div class="cat-bar-meta">
          <span>${cat} (${pct}%)</span>
          <span style="color:${color}">${formatVND(amt)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width: ${pct}%; background-color: ${color}"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Populate Category & Month Dropdowns
function updateDropdownFilters() {
  // Category select inside modal
  el.expenseCategory.innerHTML = state.categories
    .map((cat) => `<option value="${cat}">${cat}</option>`)
    .join("");

  // Category filter dropdown
  const currentCatFilter = el.categoryFilter.value;
  el.categoryFilter.innerHTML = `<option value="all">🏷️ Tất cả danh mục</option>` +
    state.categories.map((c) => `<option value="${c}">${c}</option>`).join("");
  el.categoryFilter.value = currentCatFilter || "all";

  // Month filter dropdown
  const months = new Set();
  state.expenses.concat(state.allowances).forEach((item) => {
    if (item.date && item.date.length >= 7) {
      months.add(item.date.substring(0, 7)); // YYYY-MM
    }
  });

  const sortedMonths = Array.from(months).sort().reverse();
  const currentMonthFilter = el.monthFilter.value;
  el.monthFilter.innerHTML = `<option value="all">📅 Tất cả thời gian</option>` +
    sortedMonths.map((ym) => {
      const [y, m] = ym.split("-");
      return `<option value="${ym}">Tháng ${m}/${y}</option>`;
    }).join("");
  el.monthFilter.value = currentMonthFilter || "all";
}

// Render Filtered Expenses List
function renderExpenses() {
  const { search, month, category, onlyReceipts } = state.filters;
  const q = search.trim().toLowerCase();

  const filtered = state.expenses.filter((item) => {
    if (month !== "all" && (!item.date || !item.date.startsWith(month))) {
      return false;
    }
    if (category !== "all" && item.category !== category) {
      return false;
    }
    const hasReceipt = Boolean(item.receiptId || item.receiptDataUrl);
    if (onlyReceipts && !hasReceipt) {
      return false;
    }
    if (q) {
      const matchTitle = (item.title || "").toLowerCase().includes(q);
      const matchNote = (item.note || "").toLowerCase().includes(q);
      const matchCat = (item.category || "").toLowerCase().includes(q);
      if (!matchTitle && !matchNote && !matchCat) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    el.expensesList.innerHTML = `
      <div class="empty-state card">
        <span class="empty-icon">📂</span>
        <h3>Không tìm thấy khoản chi nào</h3>
        <p>Thử điều chỉnh bộ lọc hoặc từ khóa tìm kiếm</p>
      </div>
    `;
    return;
  }

  el.expensesList.innerHTML = filtered
    .map((exp) => {
      const receiptImgSrc = receiptSrcOf(exp);
      const hasReceipt = Boolean(receiptImgSrc);
      const editCount = Number(exp.editCount || 0) || (Array.isArray(exp.editHistory) ? exp.editHistory.length : 0);
      const isEdited = editCount > 0;
      const canEdit = state.isAdmin && !isEdited;

      return `
      <div class="card expense-item">
        <div class="expense-left">
          <div class="receipt-thumb-wrap" onclick="viewReceipt('${exp.id}')" title="${hasReceipt ? 'Bấm để phóng to xem hóa đơn' : 'Không có ảnh hóa đơn'}">
            ${
              hasReceipt
                ? `<img src="${receiptImgSrc}" alt="Hóa đơn" loading="lazy">
                   <span class="thumb-badge">Ảnh 🔍</span>`
                : `<span class="no-receipt-icon">🧾</span>`
            }
          </div>
          <div class="expense-details">
            <h4 class="expense-title">${escapeHtml(exp.title)}</h4>
            <div class="expense-meta">
              <span class="badge badge-cat">${exp.category || "Khác"}</span>
              <span>📅 ${formatDate(exp.date)}</span>
              ${hasReceipt ? `<span class="text-emerald" style="font-weight:600">✓ Có hóa đơn</span>` : ""}
              ${isEdited ? `<span class="badge badge-edit">✏️ Đã sửa 1 lần</span>` : ""}
            </div>
            ${exp.note ? `<p class="expense-note">"${escapeHtml(exp.note)}"</p>` : ""}
            ${isEdited ? `<p class="expense-note">Sửa lần cuối: ${formatDateTime(exp.editedAt)} — thông tin cũ vẫn được lưu ở mục Lịch Sử Sửa.</p>` : ""}
          </div>
        </div>
        <div class="expense-right">
          <span class="expense-amount">-${formatVND(exp.amount)}</span>
          <div class="expense-actions">
            ${
              hasReceipt
                ? `<button class="btn btn-sm btn-outline" onclick="viewReceipt('${exp.id}')">Xem hóa đơn</button>`
                : ""
            }
            ${
              canEdit
                ? `<button class="btn btn-sm btn-outline" onclick="openEditExpense('${exp.id}')" title="Mỗi khoản chi chỉ được sửa 1 lần">✏️ Sửa</button>`
                : ""
            }
            ${
              isEdited
                ? `<button class="btn btn-sm btn-outline" onclick="openEditHistory('${exp.id}')" title="Xem thông tin và hóa đơn cũ trước khi sửa">🕘 Lịch sử sửa</button>`
                : ""
            }
            ${
              state.isAdmin
                ? `<button class="btn btn-sm btn-danger" onclick="deleteExpenseItem('${exp.id}')">Xóa</button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Render Allowances Timeline
function renderAllowances() {
  if (state.allowances.length === 0) {
    el.allowancesList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💌</span>
        <p>Chưa có đợt gửi tiền trợ cấp nào được ghi nhận</p>
      </div>
    `;
    return;
  }

  el.allowancesList.innerHTML = state.allowances
    .map((item) => `
    <div class="allowance-item">
      <div class="allowance-info">
        <span class="allowance-date">📅 Ngày nhận: ${formatDate(item.date)}</span>
        <span class="allowance-note">${escapeHtml(item.note || "Mẹ gửi trợ cấp")}</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <span class="allowance-amount">+${formatVND(item.amount)}</span>
        ${
          state.isAdmin
            ? `<button class="btn btn-sm btn-danger" onclick="deleteAllowanceItem('${item.id}')">Xóa</button>`
            : ""
        }
      </div>
    </div>
  `)
    .join("");
}

// --- EDIT HISTORY ---

// Gom tất cả lần chỉnh sửa của mọi khoản chi (mới nhất trước).
function collectEditEntries() {
  const entries = [];
  state.expenses.forEach((exp) => {
    (Array.isArray(exp.editHistory) ? exp.editHistory : []).forEach((entry) => {
      entries.push({ exp, entry });
    });
  });
  return entries.sort((a, b) => String(b.entry.editedAt || "").localeCompare(String(a.entry.editedAt || "")));
}

function buildHistoryRows(entry) {
  const before = entry.before || {};
  const after = entry.after || {};
  const formatValue = (key, value) => {
    if (key === "amount") return formatVND(Number(value) || 0);
    if (key === "date") return value ? formatDate(value) : "—";
    if (key === "note") return value ? escapeHtml(value) : "—";
    return value ? escapeHtml(String(value)) : "—";
  };
  const isSame = (key, a, b) => {
    if (key === "amount") return Number(a || 0) === Number(b || 0);
    return String(a || "") === String(b || "");
  };

  return [
    { key: "title", label: "Tên khoản chi" },
    { key: "amount", label: "Số tiền" },
    { key: "category", label: "Danh mục" },
    { key: "date", label: "Ngày chi" },
    { key: "note", label: "Ghi chú" }
  ].map((row) => ({
    ...row,
    old: formatValue(row.key, before[row.key]),
    new: formatValue(row.key, after[row.key]),
    changed: !isSame(row.key, before[row.key], after[row.key])
  }));
}

function renderHistoryReceipt(src, label, hint) {
  const content = src
    ? `<img src="${src}" alt="${label}" loading="lazy" onclick="viewImage(this.src, '${label}')">`
    : `<span class="no-receipt">Không có ảnh hóa đơn</span>`;
  return `<div class="history-receipt">${content}${hint ? `<div class="history-receipt-hint">${hint}</div>` : ""}</div>`;
}

function renderHistoryEntry(exp, entry) {
  const rows = buildHistoryRows(entry);
  const changedCount = rows.filter((row) => row.changed).length;
  const oldSrc = receiptSrcOf(entry.before);
  const newSrc = receiptSrcOf(entry.after);
  const renderRows = (side) =>
    rows
      .map(
        (row) => `
        <div class="history-row${row.changed ? " changed" : ""}">
          <span class="history-row-label">${row.label}</span>
          <span class="history-row-value">${row[side]}</span>
        </div>`
      )
      .join("");

  return `
    <div class="history-entry">
      <div class="history-entry-head">
        <span class="history-entry-title">🧾 ${escapeHtml((entry.after && entry.after.title) || exp.title)}</span>
        <span class="history-time">🕘 ${formatDateTime(entry.editedAt)} · ${changedCount} thông tin thay đổi</span>
      </div>
      <div class="history-compare">
        <div class="history-col is-old">
          <h5>Trước khi sửa (bản gốc)</h5>
          ${renderRows("old")}
          ${renderHistoryReceipt(oldSrc, "Hóa đơn cũ", oldSrc ? "Ảnh hóa đơn cũ được giữ nguyên tại đây" : "")}
        </div>
        <div class="history-col is-new">
          <h5>Sau khi sửa</h5>
          ${renderRows("new")}
          ${renderHistoryReceipt(newSrc, "Hóa đơn mới")}
        </div>
      </div>
    </div>`;
}

function renderEditHistoryTab() {
  if (!el.editHistoryList) return;
  const entries = collectEditEntries();
  if (entries.length === 0) {
    el.editHistoryList.innerHTML = `
      <div class="history-empty">
        Chưa có khoản chi nào được sửa.<br>
        Mỗi khoản chi chỉ được sửa 1 lần, thông tin và hóa đơn cũ sẽ được lưu lại ở đây.
      </div>`;
    return;
  }
  el.editHistoryList.innerHTML = entries.map(({ exp, entry }) => renderHistoryEntry(exp, entry)).join("");
}

// Mở lịch sử chỉnh sửa của một khoản chi
window.openEditHistory = function (expenseId) {
  const exp = state.expenses.find((e) => e.id === expenseId);
  if (!exp) return;
  const history = Array.isArray(exp.editHistory) ? exp.editHistory : [];
  if (history.length === 0) {
    showToast("Khoản chi này chưa có lần chỉnh sửa nào");
    return;
  }

  const header = `
    <div class="history-entry-head" style="margin-bottom:1rem">
      <span class="history-entry-title">${escapeHtml(exp.title)} — ${formatVND(exp.amount)}</span>
      <span class="history-time">📅 ${formatDate(exp.date)} · đã sửa ${history.length} lần</span>
    </div>`;

  el.editHistoryBody.innerHTML =
    header +
    history
      .slice()
      .reverse()
      .map((entry) => renderHistoryEntry(exp, entry))
      .join("");
  el.editHistoryModal.classList.add("show");
};

// Master Render
function renderAll() {
  renderSummary();
  updateDropdownFilters();
  renderExpenses();
  renderAllowances();
  renderEditHistoryTab();
}

// View any image in Lightbox Modal
window.viewImage = function (imgSrc, title) {
  if (!imgSrc) return;
  el.lightboxImage.src = imgSrc;
  el.lightboxTitle.textContent = title || "Hóa đơn chi tiết";
  el.lightboxDownload.href = imgSrc;
  el.lightboxModal.classList.add("show");
};

// View Receipt in Lightbox Modal
window.viewReceipt = function (expenseId) {
  const exp = state.expenses.find((e) => e.id === expenseId);
  if (!exp) return;

  const imgSrc = receiptSrcOf(exp);
  if (!imgSrc) {
    showToast("Khoản chi này không đính kèm ảnh chụp hóa đơn");
    return;
  }

  window.viewImage(imgSrc, `${exp.title} - ${formatVND(exp.amount)} (${formatDate(exp.date)})`);
};

// Đưa form khoản chi về chế độ "Thêm mới"
function resetExpenseFormMode() {
  state.editingExpenseId = null;
  state.removeReceipt = false;
  state.pendingReceiptBase64 = null;
  if (el.expenseModalTitle) el.expenseModalTitle.textContent = "🧾 Thêm Khoản Chi Tiêu & Hóa Đơn Mới";
  const saveBtn = document.getElementById("btnSaveExpense");
  if (saveBtn) saveBtn.textContent = "Lưu Khoản Chi";
  if (el.editNotice) el.editNotice.classList.add("hidden");
  const errElem = document.getElementById("expenseFormError");
  if (errElem) errElem.classList.add("hidden");
  if (el.receiptFileInput) el.receiptFileInput.value = "";
  if (el.receiptCameraInput) el.receiptCameraInput.value = "";
  if (el.previewImage) el.previewImage.src = "";
  if (el.uploadPreview) el.uploadPreview.classList.add("hidden");
}

// Mở form sửa khoản chi (mỗi khoản chỉ được sửa 1 lần)
window.openEditExpense = function (expenseId) {
  const exp = state.expenses.find((e) => e.id === expenseId);
  if (!exp) return;

  const editCount =
    Number(exp.editCount || 0) ||
    (Array.isArray(exp.editHistory) ? exp.editHistory.length : 0);
  if (editCount >= 1) {
    showToast("⚠️ Khoản chi này đã được sửa 1 lần, không thể sửa tiếp. Xem lại ở mục Lịch Sử Sửa.");
    return;
  }

  state.editingExpenseId = exp.id;
  state.removeReceipt = false;
  state.pendingReceiptBase64 = null;

  el.expenseTitle.value = exp.title || "";
  el.expenseAmount.value = exp.amount != null ? String(exp.amount) : "";
  el.expenseAmount.dispatchEvent(new Event("input"));
  el.expenseCategory.value = exp.category || "Khác";
  el.expenseDate.value = exp.date || new Date().toISOString().split("T")[0];
  el.expenseNote.value = exp.note || "";

  if (el.expenseModalTitle) el.expenseModalTitle.textContent = "✏️ Sửa Khoản Chi / Hóa Đơn";
  const saveBtn = document.getElementById("btnSaveExpense");
  if (saveBtn) saveBtn.textContent = "Lưu Thay Đổi";
  if (el.editNotice) el.editNotice.classList.remove("hidden");
  const errElem = document.getElementById("expenseFormError");
  if (errElem) errElem.classList.add("hidden");

  if (el.receiptFileInput) el.receiptFileInput.value = "";
  if (el.receiptCameraInput) el.receiptCameraInput.value = "";
  el.previewImage.src = "";
  el.uploadPreview.classList.add("hidden");

  const currentReceipt = receiptSrcOf(exp);
  if (currentReceipt) {
    el.previewImage.src = currentReceipt;
    el.previewInfo.textContent = "Ảnh hóa đơn hiện tại · thay ảnh mới thì ảnh này vẫn được lưu vào lịch sử";
    el.uploadPreview.classList.remove("hidden");
  }

  openModal(el.addExpenseModal);
};

// Delete Expense
window.deleteExpenseItem = async function (id) {
  if (!confirm("Bạn có chắc chắn muốn xóa khoản chi này khỏi sổ không?")) return;

  if (state.isApiMode) {
    try {
      const res = await fetch(`/api/expense?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin-pin": state.adminPin }
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || "Không thể xóa");
        return;
      }
    } catch (err) {
      alert("Lỗi khi kết nối máy chủ: " + err.message);
      return;
    }
  }

  state.expenses = state.expenses.filter((e) => e.id !== id);
  saveLocalData();
  renderAll();
  showToast("🗑️ Đã xóa khoản chi");
};

// Delete Allowance
window.deleteAllowanceItem = async function (id) {
  if (!confirm("Bạn có chắc muốn xóa đợt trợ cấp này không?")) return;

  if (state.isApiMode) {
    try {
      const res = await fetch(`/api/allowance?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin-pin": state.adminPin }
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || "Không thể xóa");
        return;
      }
    } catch (err) {
      alert("Lỗi kết nối máy chủ: " + err.message);
      return;
    }
  }

  state.allowances = state.allowances.filter((a) => a.id !== id);
  saveLocalData();
  renderAll();
  showToast("🗑️ Đã xóa đợt trợ cấp");
};

// Modal helpers
function openModal(modal) {
  modal.classList.add("show");
}

function closeModal(modal) {
  modal.classList.remove("show");
}

// Escape HTML utility
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Event Listeners
function setupEventListeners() {
  // Số tiền: cho phép số lẻ, xem trước định dạng ngay khi nhập
  syncAmountHint(el.expenseAmount, el.expenseAmountHint, AMOUNT_HINT_DEFAULT);
  syncAmountHint(el.allowanceAmount, el.allowanceAmountHint, AMOUNT_HINT_DEFAULT);
  if (el.expenseAmount) el.expenseAmount.addEventListener("paste", handleAmountPaste);
  if (el.allowanceAmount) el.allowanceAmount.addEventListener("paste", handleAmountPaste);

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

  // Modal Close buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-close");
      const modal = document.getElementById(modalId);
      if (modal) closeModal(modal);
    });
  });

  // Lightbox close
  el.lightboxClose.addEventListener("click", () => el.lightboxModal.classList.remove("show"));
  el.lightboxModal.addEventListener("click", (e) => {
    if (e.target === el.lightboxModal) el.lightboxModal.classList.remove("show");
  });

  // Auth Toggle button (Chế độ xem Mẹ <-> Quản lý)
  if (el.authToggle) {
    el.authToggle.addEventListener("click", () => {
      if (state.isAdmin) {
        if (confirm("Chuyển về chế độ chỉ xem của Mẹ?")) {
          logoutAdmin();
        }
      } else {
        el.pinInput.value = "";
        el.pinError.classList.add("hidden");
        openModal(el.pinModal);
        setTimeout(() => el.pinInput.focus(), 100);
      }
    });
  }

  // Submit PIN
  if (el.btnSubmitPin) {
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
        el.pinError.textContent = "Mật khẩu không chính xác! Hãy kiểm tra lại biến ADMIN_PIN trên Netlify.";
        el.pinError.classList.remove("hidden");
      }
    });
  }

  if (el.pinInput) {
    el.pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.btnSubmitPin.click();
    });
  }

  // Open Add Expense Modal
  el.btnOpenAddExpense.addEventListener("click", () => {
    resetExpenseFormMode();
    el.expenseDate.value = new Date().toISOString().split("T")[0];
    el.expenseTitle.value = "";
    el.expenseAmount.value = "";
    el.expenseAmount.dispatchEvent(new Event("input"));
    el.expenseNote.value = "";
    clearReceiptPreview();
    openModal(el.addExpenseModal);
  });

  // Open Add Allowance Modal
  const openAllowanceModal = () => {
    el.allowanceDate.value = new Date().toISOString().split("T")[0];
    el.allowanceAmount.value = "";
    el.allowanceAmount.dispatchEvent(new Event("input"));
    el.allowanceNote.value = "Mẹ gửi tiền sinh hoạt";
    openModal(el.addAllowanceModal);
  };
  el.btnOpenAddAllowance.addEventListener("click", openAllowanceModal);
  el.btnTabAddAllowance.addEventListener("click", openAllowanceModal);

  // File Upload Handlers (Gallery vs Camera)
  async function processSelectedFile(file) {
    if (!file) return;
    try {
      showToast("⏳ Đang xử lý và tối ưu ảnh hóa đơn...");
      const result = await compressImage(file, 1280, 0.82);
      state.pendingReceiptBase64 = result.dataUrl;
      state.removeReceipt = false;

      el.previewImage.src = result.dataUrl;
      el.previewInfo.textContent = `${result.originalSizeKb} KB ➔ ${result.compressedSizeKb} KB (Đã tối ưu)`;
      if (el.uploadPreview) el.uploadPreview.classList.remove("hidden");
    } catch (err) {
      alert("Không thể đọc ảnh: " + err.message);
    }
  }

  if (el.btnChooseGallery) {
    el.btnChooseGallery.addEventListener("click", () => {
      if (el.receiptFileInput) el.receiptFileInput.click();
    });
  }

  if (el.btnChooseCamera) {
    el.btnChooseCamera.addEventListener("click", () => {
      if (el.receiptCameraInput) el.receiptCameraInput.click();
    });
  }

  if (el.receiptFileInput) {
    el.receiptFileInput.addEventListener("change", (e) => {
      processSelectedFile(e.target.files[0]);
    });
  }

  if (el.receiptCameraInput) {
    el.receiptCameraInput.addEventListener("change", (e) => {
      processSelectedFile(e.target.files[0]);
    });
  }

  if (el.btnRemoveImage) {
    el.btnRemoveImage.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.editingExpenseId) {
        // Ảnh cũ vẫn được giữ trong blob store để xem lại ở lịch sử chỉnh sửa
        state.removeReceipt = true;
        showToast("📌 Ảnh hóa đơn cũ sẽ được lưu lại trong Lịch Sử Sửa");
      }
      clearReceiptPreview();
    });
  }

  function clearReceiptPreview() {
    state.pendingReceiptBase64 = null;
    if (el.receiptFileInput) el.receiptFileInput.value = "";
    if (el.receiptCameraInput) el.receiptCameraInput.value = "";
    if (el.previewImage) el.previewImage.src = "";
    if (el.uploadPreview) el.uploadPreview.classList.add("hidden");
  }

  // Handle Add / Edit Expense Form Submit
  el.addExpenseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = el.expenseTitle.value.trim();
    const amount = parseAmount(el.expenseAmount.value);
    const category = el.expenseCategory.value;
    const date = el.expenseDate.value;
    const note = el.expenseNote.value.trim();
    const errElem = document.getElementById("expenseFormError");
    const isEditing = Boolean(state.editingExpenseId);
    const editingExpense = isEditing
      ? state.expenses.find((item) => item.id === state.editingExpenseId)
      : null;

    if (!title || amount == null) {
      errElem.textContent = "Vui lòng nhập đầy đủ tên và số tiền hợp lệ (lớn hơn 0)!";
      errElem.classList.remove("hidden");
      return;
    }

    if (isEditing) {
      const editCount = editingExpense
        ? Number(editingExpense.editCount || 0) ||
          (Array.isArray(editingExpense.editHistory) ? editingExpense.editHistory.length : 0)
        : 0;
      if (!editingExpense || editCount >= 1) {
        errElem.textContent = editingExpense
          ? "Khoản chi này đã được sửa 1 lần. Mỗi khoản chi chỉ được sửa duy nhất 1 lần."
          : "Không tìm thấy khoản chi cần sửa.";
        errElem.classList.remove("hidden");
        return;
      }
    }

    const saveBtn = document.getElementById("btnSaveExpense");
    const defaultBtnLabel = isEditing ? "Lưu Thay Đổi" : "Lưu Khoản Chi";
    saveBtn.disabled = true;
    saveBtn.textContent = "Đang lưu...";

    if (state.isApiMode) {
      try {
        const payload = { title, amount, category, date, note, pin: state.adminPin };
        if (isEditing) {
          payload.id = state.editingExpenseId;
          payload.removeReceipt = state.removeReceipt;
        }
        payload.receiptBase64 = state.pendingReceiptBase64;

        const res = await fetch("/api/expense", {
          method: isEditing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": state.adminPin
          },
          body: JSON.stringify(payload)
        });

        const json = await res.json();
        if (!json.success) {
          errElem.textContent = json.error || "Lỗi khi lưu khoản chi";
          errElem.classList.remove("hidden");
          saveBtn.disabled = false;
          saveBtn.textContent = defaultBtnLabel;
          return;
        }

        if (isEditing) {
          const index = state.expenses.findIndex((item) => item.id === json.item.id);
          if (index >= 0) state.expenses[index] = json.item;
          else state.expenses.unshift(json.item);
        } else {
          state.expenses.unshift(json.item);
        }
      } catch (err) {
        errElem.textContent = "Lỗi kết nối máy chủ: " + err.message;
        errElem.classList.remove("hidden");
        saveBtn.disabled = false;
        saveBtn.textContent = defaultBtnLabel;
        return;
      }
    } else if (isEditing) {
      // Local mode: cập nhật khoản chi và lưu bản cũ vào lịch sử
      const before = snapshotExpense(editingExpense);
      const editedAt = new Date().toISOString();
      const newReceiptDataUrl = state.pendingReceiptBase64
        ? state.pendingReceiptBase64
        : state.removeReceipt
          ? null
          : editingExpense.receiptDataUrl || null;

      editingExpense.title = title;
      editingExpense.amount = amount;
      editingExpense.category = category;
      editingExpense.date = date;
      editingExpense.note = note;
      editingExpense.receiptId = null;
      editingExpense.receiptMime = null;
      editingExpense.receiptDataUrl = newReceiptDataUrl;
      editingExpense.editCount = 1;
      editingExpense.editedAt = editedAt;
      editingExpense.editHistory = Array.isArray(editingExpense.editHistory) ? editingExpense.editHistory : [];
      editingExpense.editHistory.push({ editedAt, before, after: snapshotExpense(editingExpense) });
      saveLocalData();
    } else {
      // Local mode: thêm khoản chi mới
      const newExp = {
        id: "exp_" + Date.now(),
        title,
        amount,
        category,
        date,
        note,
        receiptId: null,
        receiptDataUrl: state.pendingReceiptBase64,
        createdAt: new Date().toISOString()
      };
      state.expenses.unshift(newExp);
      saveLocalData();
    }

    const wasEditing = isEditing;
    saveBtn.disabled = false;
    saveBtn.textContent = defaultBtnLabel;
    closeModal(el.addExpenseModal);
    resetExpenseFormMode();
    renderAll();
    showToast(
      wasEditing
        ? "✅ Đã cập nhật khoản chi — mỗi khoản chỉ được sửa 1 lần, bản cũ đã lưu ở Lịch Sử Sửa!"
        : "✅ Đã ghi nhận khoản chi & hóa đơn thành công!"
    );
  });

  // Handle Add Allowance Form Submit
  el.addAllowanceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseAmount(el.allowanceAmount.value);
    const date = el.allowanceDate.value;
    const note = el.allowanceNote.value.trim();
    const errElem = document.getElementById("allowanceFormError");

    if (amount == null) {
      errElem.textContent = "Vui lòng nhập số tiền hợp lệ (lớn hơn 0)!";
      errElem.classList.remove("hidden");
      return;
    }

    const saveBtn = document.getElementById("btnSaveAllowance");
    saveBtn.disabled = true;
    saveBtn.textContent = "Đang lưu...";

    if (state.isApiMode) {
      try {
        const res = await fetch("/api/allowance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": state.adminPin
          },
          body: JSON.stringify({ amount, date, note, pin: state.adminPin })
        });
        const json = await res.json();
        if (!json.success) {
          errElem.textContent = json.error || "Không thể lưu";
          errElem.classList.remove("hidden");
          saveBtn.disabled = false;
          saveBtn.textContent = "Lưu Vào Sổ";
          return;
        }
        state.allowances.unshift(json.item);
      } catch (err) {
        errElem.textContent = "Lỗi kết nối: " + err.message;
        errElem.classList.remove("hidden");
        saveBtn.disabled = false;
        saveBtn.textContent = "Lưu Vào Sổ";
        return;
      }
    } else {
      const newAlw = {
        id: "alw_" + Date.now(),
        amount,
        date,
        note: note || "Mẹ gửi tiền trợ cấp",
        createdAt: new Date().toISOString()
      };
      state.allowances.unshift(newAlw);
      saveLocalData();
    }

    saveBtn.disabled = false;
    saveBtn.textContent = "Lưu Vào Sổ";
    closeModal(el.addAllowanceModal);
    renderAll();
    showToast("✅ Đã ghi nhận đợt tiền mẹ gửi!");
  });

  // Filter event listeners
  el.searchInput.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderExpenses();
  });

  el.monthFilter.addEventListener("change", (e) => {
    state.filters.month = e.target.value;
    renderExpenses();
  });

  el.categoryFilter.addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    renderExpenses();
  });

  el.onlyReceiptsFilter.addEventListener("change", (e) => {
    state.filters.onlyReceipts = e.target.checked;
    renderExpenses();
  });

  // Share summary via Zalo / Copy
  el.btnShareSummary.addEventListener("click", () => {
    const totalAllow = state.allowances.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const totalExp = state.expenses.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const balance = totalAllow - totalExp;
    const countWithReceipt = state.expenses.filter((e) => e.receiptId || e.receiptDataUrl).length;

    const reportText = [
      `🧾 BÁO CÁO CHI TIÊU & TIỀN TRỢ CẤP`,
      `📅 Ngày lập: ${new Date().toLocaleDateString("vi-VN")}`,
      `--------------------------`,
      `💰 Tổng tiền Mẹ đã cấp: ${formatVND(totalAllow)} (${state.allowances.length} đợt)`,
      `🛒 Tổng con đã chi tiêu: ${formatVND(totalExp)} (${state.expenses.length} khoản, ${countWithReceipt} có ảnh hóa đơn)`,
      `🏦 Số dư hiện tại: ${formatVND(balance)}`,
      `--------------------------`,
      `Mẹ có thể mở trực tiếp link web để bấm xem ảnh chi tiết từng hóa đơn con đã chụp lưu lại nhé!`
    ].join("\n");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reportText).then(() => {
        showToast("📋 Đã sao chép nội dung báo cáo! Bạn có thể dán vào Zalo gửi Mẹ ngay.");
      }).catch(() => {
        prompt("Sao chép nội dung gửi Zalo:", reportText);
      });
    } else {
      prompt("Sao chép nội dung gửi Zalo:", reportText);
    }
  });

  // Reset All Data button
  if (el.btnResetAllData) {
    el.btnResetAllData.addEventListener("click", async () => {
      const confirmed = confirm(
        "⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu chi tiêu và tiền trợ cấp không?\n\nThao tác này sẽ xóa sạch dữ liệu để bạn bắt đầu ghi sổ từ đầu."
      );
      if (!confirmed) return;

      if (state.isApiMode) {
        try {
          const res = await fetch("/api/reset", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-pin": state.adminPin
            },
            body: JSON.stringify({ pin: state.adminPin })
          });
          const json = await res.json();
          if (!json.success) {
            alert(json.error || "Không thể reset dữ liệu trên máy chủ");
            return;
          }
        } catch (err) {
          alert("Lỗi kết nối máy chủ: " + err.message);
          return;
        }
      }

      state.allowances = [];
      state.expenses = [];
      saveLocalData();
      renderAll();
      showToast("🗑️ Đã xóa sạch toàn bộ dữ liệu. Sổ chi tiêu đã sẵn sàng từ đầu!");
    });
  }
}

// App Initialization
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  setupEventListeners();
  loadAppData();
});
