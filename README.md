# 🧾 Sổ Chi Tiêu & Hóa Đơn Trợ Cấp (Cho Mẹ & Con)

Trang web giúp bạn liệt kê chi tiết từng hóa đơn, các khoản đã chi tiêu từ tiền mẹ trợ cấp, và cập nhật số dư còn lại. Mẹ có thể mở trực tiếp trên điện thoại để xem và phóng to từng ảnh hóa đơn đối soát.

---

## 🌟 Tính Năng Nổi Bật

1. **Phân quyền thông minh (Chế độ xem của Mẹ & Quản lý bằng mã PIN)**:
   - **Mẹ mở web**: Giao diện chỉ xem sạch sẽ, dễ đọc, chữ to, xem được toàn bộ danh sách, tổng tiền mẹ gửi, tổng tiền đã tiêu, số dư còn lại và phóng to từng ảnh hóa đơn.
   - **Con (Người quản lý)**: Nhập mã PIN (mặc định: `1234`) để mở quyền Thêm khoản chi mới, chụp hóa đơn và ghi nhận đợt tiền mẹ chuyển.
2. **Đính kèm & nén ảnh hóa đơn**:
   - Chụp ảnh trực tiếp từ camera điện thoại hoặc tải ảnh từ máy.
   - Trình duyệt tự động nén ảnh (giảm từ 5–10MB xuống ~150KB) giúp mẹ mở xem tức thì qua mạng 4G/3G mà không bị mờ.
   - Bấm vào ảnh để mở hộp thoại phóng to (Lightbox).
3. **Thống kê & Bộ lọc trực quan**:
   - Thanh phân bổ % chi tiêu theo danh mục (`Ăn uống`, `Tiền nhà`, `Học tập`, `Đi lại`...).
   - Lọc theo tháng, lọc theo danh mục, tìm kiếm theo tên hoặc ghi chú, hoặc chỉ lọc những khoản có hóa đơn.
4. **Chia sẻ nhanh qua Zalo**:
   - 1 nút bấm tự động sao chép tóm tắt tình hình chi tiêu để dán gửi Zalo cho mẹ.

---

## 🚀 Hướng Dẫn Deploy Lên Netlify

### Cách 1: Deploy qua Git (GitHub / GitLab / Bitbucket)
1. Đẩy mã nguồn dự án lên GitHub của bạn:
   ```bash
   git add .
   git commit -m "Khoi tao so chi tieu va hoa don"
   git push origin main
   ```
2. Đăng nhập [Netlify](https://app.netlify.com) và chọn **"Add new site" > "Import an existing project"**.
3. Chọn repo GitHub của bạn:
   - **Publish directory**: `.` (để trống hoặc chấm)
   - **Functions directory**: `netlify/functions`
4. (Tùy chọn) Đổi mã PIN bảo mật:
   - Vào **Site configuration > Environment variables**, thêm biến:
     - `ADMIN_PIN`: *<Mã PIN bạn muốn, ví dụ: 8888>*
5. Bấm **Deploy Site**. Khi xong, Netlify sẽ cấp cho bạn một đường link miễn phí (ví dụ `https://so-chi-tieu.netlify.app`), bạn chỉ cần gửi link này cho Mẹ lưu vào Zalo hoặc màn hình chính điện thoại!

---

### Cách 2: Deploy trực tiếp bằng Netlify CLI
1. Cài đặt Netlify CLI nếu chưa có:
   ```bash
   npm install -g netlify-cli
   ```
2. Đăng nhập và deploy:
   ```bash
   netlify login
   netlify init
   netlify deploy --prod
   ```

---

## 💻 Chạy Thử Trên Máy Tính (Local Dev)

- **Chạy trực tiếp với máy chủ tĩnh**:
  Mở trực tiếp file `index.html` trên trình duyệt (hệ thống sẽ tự động lưu dữ liệu vào `localStorage`).
- **Chạy giả lập đầy đủ cả Netlify Functions & Blobs**:
  ```bash
  npx netlify dev
  ```
  Trang web sẽ chạy tại `http://localhost:8888`.
