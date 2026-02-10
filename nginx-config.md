# OpenMD Nginx 配置文件
# 使用方法：
# 1. 复制此文件到 /etc/nginx/sites-available/md.yuanze.com
# 2. 创建软链接：sudo ln -s /etc/nginx/sites-available/md.yuanze.com /etc/nginx/sites-enabled/
# 3. 测试配置：sudo nginx -t
# 4. 重载配置：sudo nginx -s reload

server {
    listen 80;
    listen [::]:80;
    server_name md.yuanze.com;

    # 日志配置
    access_log /var/log/nginx/md.yuanze.com.access.log;
    error_log /var/log/nginx/md.yuanze.com.error.log;

    # 代理所有请求到 OpenMD 服务器（监听 80 端口）
    location / {
        proxy_pass http://localhost:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 禁用缓存
        proxy_cache_bypass $http_upgrade;
        proxy_no_cache 1;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
