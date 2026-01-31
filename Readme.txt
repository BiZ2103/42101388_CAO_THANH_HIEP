-Server.js: máy chủ
Dòng 1 – 31: Khai báo thư viện và cấu hình các thông số kết nối (MQTT, Telegram, Google Sheets).

Dòng 33 – 86: Thiết lập hệ thống thông báo Telegram, lưu lịch sử chat và đồng bộ cảnh báo lên Google Sheets.

Dòng 88 – 147: Quản lý việc lưu trữ dữ liệu vào ổ cứng (JSON) và khởi tạo các biến lưu trạng thái hệ thống.

Dòng 149 – 250: Xử lý ngôn ngữ tự nhiên để trả lời các câu hỏi về thông số trạm bơm và thông tin sinh viên Cao Thanh Hiệp.

Dòng 280 – 327: Thiết lập kết nối và đăng ký nhận dữ liệu từ Broker MQTT.

Dòng 330 – 434: Xử lý dữ liệu cảm biến, tính toán lưu lượng nước, tự động chốt báo cáo ngày và giám sát lỗi hệ thống.

Dòng 436 – 540: Điều khiển logic chạy tự động theo lịch trình, bao gồm cả việc tự ngắt khi bơm đủ khối lượng nước.

Dòng 557 – 663: Xây dựng các API HTTP để giao diện Web có thể điều khiển bơm và lấy dữ liệu biểu đồ.

Dòng 665 – 725: Quản lý việc gửi tin nhắn từ Admin và hệ thống nhắc nhở lịch trình trước khi chạy.

HOME.HTML: Giao diện người dùng
Dòng 1 – 355: Thiết lập giao diện (CSS), phong cách Dark Mode và các hiệu ứng hoạt họa (nước chảy, bơm rung).

Dòng 357 – 410: Xây dựng màn hình đăng nhập bảo mật cho quản trị viên.

Dòng 413 – 520: Thiết kế bảng điều khiển hệ thống và các ô hiển thị thông số đo lường thời gian thực.

Dòng 522 – 625: Tạo sơ đồ công nghệ (SCADA) bằng hình ảnh SVG để mô phỏng hoạt động của trạm bơm trực quan.

Dòng 627 – 663: Thiết lập khu vực hiển thị biểu đồ lịch sử áp suất, tần số và lưu lượng.

Dòng 665 – 760: Xây dựng giao diện quản lý và thiết lập lịch vận hành tự động.

Dòng 762 – 825: Tạo cửa sổ hỗ trợ của trợ lý ảo (Chatbot) và thanh điều hướng các tính năng.

Dòng 827 – 1334: Xử lý logic JavaScript để kết nối API, cập nhật dữ liệu lên giao diện và điều khiển thiết bị.



