#!/bin/bash
# OpenMD Nginx 配置部署脚本
# 使用方法：sudo bash deploy-nginx.sh

set -e

echo "🚀 开始部署 OpenMD Nginx 配置..."

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}请使用 sudo 运行此脚本${NC}"
    echo "使用方法: sudo bash deploy-nginx.sh"
    exit 1
fi

# 配置文件路径
CONFIG_SOURCE="/home/node/.openclaw/workspace/openmd/nginx-config.txt"
CONFIG_TARGET="/etc/nginx/sites-available/md.yuanze.com"
CONFIG_LINK="/etc/nginx/sites-enabled/md.yuanze.com"

echo "📝 创建 Nginx 配置文件..."

# 创建配置文件内容
cat > /tmp/md.yuanze.com.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name md.yuanze.com;

    access_log /var/log/nginx/md.yuanze.com.access.log;
    error_log /var/log/nginx/md.yuanze.com.error.log;

    location / {
        proxy_pass http://localhost:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_no_cache 1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

# 复制配置文件
echo "📂 复制配置文件到 $CONFIG_TARGET..."
cp /tmp/md.yuanze.com.conf "$CONFIG_TARGET"

# 创建软链接
echo "🔗 创建软链接..."
ln -sf "$CONFIG_TARGET" "$CONFIG_LINK"

# 测试配置
echo "🧪 测试 Nginx 配置..."
if nginx -t; then
    echo -e "${GREEN}✅ 配置测试通过${NC}"
else
    echo -e "${YELLOW}❌ 配置测试失败，请检查配置${NC}"
    exit 1
fi

# 重载 Nginx
echo "🔄 重载 Nginx..."
if systemctl reload nginx; then
    echo -e "${GREEN}✅ Nginx 重载成功${NC}"
else
    echo -e "${YELLOW}❌ Nginx 重载失败${NC}"
    exit 1
fi

# 清理临时文件
rm /tmp/md.yuanze.com.conf

echo ""
echo -e "${GREEN}✨ 配置部署完成！${NC}"
echo ""
echo "🌐 访问地址："
echo "  - 首页: https://md.yuanze.com"
echo "  - 后台: https://md.yuanze.com/admin"
echo "  - API:  https://md.yuanze.com/api"
echo ""
echo "📋 下一步："
echo "  1. 测试访问: curl https://md.yuanze.com/admin"
echo "  2. 查看日志: sudo tail -f /var/log/nginx/md.yuanze.com.error.log"
echo ""
