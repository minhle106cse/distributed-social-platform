import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

REQUIRED_FILES = [
    "src/app.ts",
    "src/main.ts",
    "src/main.lambda.ts",
    "src/bootstrap/fastify.ts"
]

def validate_apps(workspace_root: str):
    apps_dir = os.path.join(workspace_root, "apps")
    if not os.path.isdir(apps_dir):
        logger.error(f"Thư mục apps/ không tồn tại ở: {apps_dir}")
        sys.exit(1)

    all_passed = True
    apps = [d for d in os.listdir(apps_dir) if os.path.isdir(os.path.join(apps_dir, d))]

    for app in apps:
        app_path = os.path.join(apps_dir, app)
        logger.info(f"Đang kiểm tra kiến trúc của microservice: {app}...")
        
        passed = True
        for req_file in REQUIRED_FILES:
            file_path = os.path.join(app_path, req_file)
            if not os.path.isfile(file_path):
                logger.error(f"  [THIẾU] {req_file}")
                passed = False
            else:
                logger.info(f"  [ĐẠT] {req_file}")
        
        if passed:
            logger.info(f"✅ Microservice '{app}' hoàn toàn tuân thủ kiến trúc chuẩn.")
        else:
            logger.warning(f"❌ Microservice '{app}' vi phạm chuẩn kiến trúc (Thiếu file bắt buộc).")
            all_passed = False
            
    if not all_passed:
        logger.error("Nghiệm thu thất bại: Một hoặc nhiều microservices không tuân thủ SOP.")
        sys.exit(1)
    else:
        logger.info("Nghiệm thu thành công: Tất cả microservices đều tuân thủ kiến trúc chuẩn 100%.")

if __name__ == "__main__":
    # Get workspace root (assuming script is run from execution/ directory)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_root = os.path.dirname(current_dir)
    validate_apps(workspace_root)
