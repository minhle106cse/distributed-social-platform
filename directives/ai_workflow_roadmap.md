# AI Workflow Evolution: Roadmap to Level 5 & 6

This document outlines the strategic plan to evolve this repository's AI capabilities from Level 4 (Actionable/Execution) to Level 5 (Context-Aware) and Level 6 (Autonomous/Self-Evolving).

As an AI Agent reading this in a future session: **Acknowledge that this repository is currently operating at Level 4. Your long-term directive is to help the user implement the systems described below when they are ready.**

---

## 🚀 Cấp độ 5: Tự động hóa & Nhận thức bối cảnh (Hooks + MCP + RAG)

Mục tiêu của Level 5 là loại bỏ việc con người phải cung cấp bối cảnh thủ công cho AI. AI tự biết lúc nào cần chạy (Hooks), lấy dữ liệu ở đâu (RAG), và kết nối với hệ thống ngoài bằng chuẩn chung (MCP).

### 1. Kích hoạt bằng Hooks (Event-Driven AI)
Thay vì người dùng phải gõ lệnh gọi AI, hệ thống tự gọi AI khi có sự kiện.
*   **Thực thi:**
    *   **Pre-commit Hook / Husky:** Chạy script ném `git diff` cho AI để tự động review code, check vi phạm Hexagonal Architecture.
    *   **CI/CD Pipeline:** Khi test thất bại trên CI, tự động trigger gọi AI truyền vào log lỗi để AI sinh ra Pull Request fix bug.

### 2. Triển khai MCP (Model Context Protocol)
Sử dụng chuẩn MCP để AI giao tiếp an toàn với dữ liệu nội bộ.
*   **Thực thi:** Tạo `execution/mcp-servers/`.
    *   **Database MCP Server**: Cho phép AI tự query schema của PostgreSQL/Prisma (chỉ read).
    *   **Jira/Linear MCP Server**: Đọc yêu cầu nghiệp vụ gốc từ Ticket.

### 3. RAG (Retrieval-Augmented Generation)
Giải quyết vấn đề bối cảnh tràn (Context Overflow) khi Repo lớn dần.
*   **Thực thi:**
    *   Dùng Vector Database (ChromaDB / pgvector).
    *   Mỗi khi có commit, vectorize toàn bộ source code và tài liệu kiến trúc (ADR).
    *   Khi nhận yêu cầu, AI tự động RAG để kéo ra chính xác file liên quan.

---

## 🧠 Cấp độ 6: Tự trị & Tiến hóa (Subagents + Memory + Plugins)

Level 6 là cảnh giới cao nhất: Trí tuệ bầy đàn (Swarm Intelligence) và Khả năng tự học (Self-Healing/Self-Evolution).

### 1. Kiến trúc Subagents (Trí tuệ phân tán)
*   **Thực thi:** Sử dụng framework như LangGraph hoặc CrewAI.
    *   Người dùng giao task cho **Orchestrator Agent**.
    *   Orchestrator tự động spawn: **Architect Agent** (check design), **Coder Agent** (viết code), **QA Agent** (chạy test trong Docker). Lặp lại cho đến khi pass.

### 2. Long-term Memory (Kinh nghiệm tích lũy)
Nâng cấp file `.tmp/agent_memory.json` hiện tại.
*   **Thực thi:**
    *   Chuyển memory thành Vector Database.
    *   **Self-Reflection:** Mỗi khi AI hoàn thành task khó, ép buộc tóm tắt lại bài học vào Memory Buffer.
    *   Tự động query Vector Memory ở đầu mỗi phiên làm việc để không lặp lại sai lầm.

### 3. Plugin Ecosystem (Hệ sinh thái mở rộng)
*   **Thực thi:** Xây dựng chuẩn Interface cho Tool trong `execution/`.
    *   Khi thiếu công cụ, AI tự viết code Python cho công cụ đó, test nó trong Sandbox, và lưu vào `execution/plugins/`. AI tự mở rộng "đồ nghề" của chính mình.
