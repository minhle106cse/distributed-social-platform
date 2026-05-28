# SOP: Unit Testing & Coverage Standard

> [!NOTE]
> Directive này quy định chuẩn viết Unit Test áp dụng cho toàn bộ các Microservices trong dự án, đảm bảo Code Coverage, kiến trúc thống nhất và vượt qua các trở ngại về TypeScript/ESM. Được đúc kết sau vòng lặp Self-Annealing từ Auth Service.

## 🎯 Goal
Thống nhất phương pháp tổ chức file test, cách giả lập (mock) Object, Path Aliases và cách xử lý thư viện ESM để tránh các lỗi kỹ thuật phát sinh khi chạy Jest, giúp AI Agent và Developer luôn đồng bộ cách làm.

## 📜 Kiến Trúc Test Bắt Buộc

### 1. Chiến lược Co-location
- Bắt buộc đặt file test (`*.spec.ts`) **ngay cạnh** file source logic (ví dụ `login.handler.ts` thì test phải nằm tại `login.handler.spec.ts`).
- **Nghiêm cấm** gom các file Unit Test vào folder `test/` hoặc `tests/` ở root của service. Các folder `test/` sinh ra mặc định từ CLI của framework sẽ bị xóa đi hoặc chỉ dành riêng cho E2E Testing (nếu có).

### 2. Chuẩn mực Mocking với TypeScript
- Khi mock các Dependencies (ví dụ Repositories, Services) để test Handler/Usecase, bắt buộc sử dụng cơ chế ép kiểu an toàn:
```typescript
let mockPasswordService: jest.Mocked<PasswordService>;

beforeEach(() => {
  mockPasswordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as jest.Mocked<PasswordService>;
});
```
- Điều này khắc phục triệt để lỗi TypeScript khắt khe cảnh báo thiếu các private/inherited properties của Interface hoặc Class gốc.

### 3. Quy tắc Import Path Alias (`@/`)
- Cấm sử dụng Relative Path dài (ví dụ: `../../../../errors/auth.error`). Mọi import trỏ ra khỏi cụm thư mục nội bộ bắt buộc phải dùng alias `@/`.
- File `package.json` trong service phải cấu hình Jest để nhận dạng:
```json
"jest": {
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/$1"
  }
}
```

### 4. Xử lý Thư viện Native ESM (e.g., `uuid`)
- Rất nhiều thư viện hiện đại đã chuyển hoàn toàn sang ESM. Jest (dùng Node/CommonJS) sẽ báo lỗi `SyntaxError: Unexpected token 'export'`.
- **Cách xử lý**: Không tốn thời gian đổi loader, bắt buộc dùng `jest.mock` ở cấp module ngay trên đầu các file spec:
```typescript
jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid-v7')
}));
```
