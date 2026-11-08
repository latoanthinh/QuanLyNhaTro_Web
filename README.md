# Quản lý nhà trọ

Trang web tĩnh, không cần bước build. Giữ `index.html` tại thư mục gốc để tương thích GitHub Pages.

## Cấu trúc

```text
index.html
ZL.jpg                    # ảnh cũ, hiện không được trang sử dụng
skills-lock.json
assets/
  css/
    dashboard.css
    lucian-041.css
    lucian-tokens.css
    legacy.css
src/
  firebase/
    config.js
  legacy/
    app-auth.js
docs/
  PRODUCT_TEST_CASES.md
.agents/ and .claude/      # cấu hình skill của workspace
```

- `index.html` là điểm vào và chứa logic quản trị hiện hành.
- `src/firebase/config.js` là nơi cấu hình Firebase và thông tin ngân hàng dùng bởi trang hiện hành.
- `src/legacy/app-auth.js` là phiên bản ứng dụng cũ, chưa được nạp bởi `index.html`.
- `assets/css/legacy.css` được giữ lại để tham khảo, không được nạp bởi dashboard.

## Dữ liệu Firebase

Dữ liệu không nằm trong thư mục dự án. Ứng dụng kết nối tới Firebase Realtime Database của project `quanlynhatro-e35b2`. Xem dữ liệu trong Firebase Console → Realtime Database → Data:

- `/rooms`: thông tin phòng và trạng thái thanh toán.
- `/invoices`: lịch sử hóa đơn.
- `/invoiceRequests`, `/issues`, `/chats`: dữ liệu cũ; luồng quản trị hiện hành không nạp các nhánh này và việc bỏ cổng khách không xóa dữ liệu.

Firebase Console: <https://console.firebase.google.com/project/quanlynhatro-e35b2/database/quanlynhatro-e35b2-default-rtdb/data>

Không đưa bản sao dữ liệu khách thuê hoặc tệp service-account vào Git. Firebase web config trong trình duyệt không thay thế cho quy tắc bảo mật Realtime Database.

## Chạy cục bộ

Phục vụ thư mục gốc qua HTTP (ví dụ Live Server trong VS Code); không mở `index.html` trực tiếp bằng `file://`, vì ES module cần được tải qua HTTP.
