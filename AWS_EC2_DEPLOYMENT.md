# AWS EC2 Deployment Guide for Backend

## Prerequisites

- AWS Account (created)
- Free tier eligibility
- SSH client (built-in on Mac/Linux, PuTTY on Windows)

## Step-by-Step EC2 Setup

### 1. Launch EC2 Instance

1. Go to AWS Console → EC2
2. Click "Launch Instance"
3. Choose:
   - **AMI**: Ubuntu Server 22.04 LTS (FREE tier eligible)
   - **Instance Type**: t2.micro (FREE tier)
   - **Storage**: 30 GB (within free tier)

4. Click "Launch"

### 2. Create Security Group

Allow traffic:
- **HTTP** (Port 80)
- **HTTPS** (Port 443)
- **SSH** (Port 22)
- **Custom** (Port 5000 for backend)

### 3. Generate & Download Key Pair

1. Create new key pair: `expensetracker-key`
2. Download `.pem` file (keep it safe!)
3. Store in secure location

### 4. Connect via SSH

**On Mac/Linux:**
```bash
chmod 400 expensetracker-key.pem
ssh -i expensetracker-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>
```

**On Windows (use PuTTY):**
1. Convert .pem to .ppk (use PuTTYgen)
2. Open PuTTY
3. Add key pair
4. Connect to `ubuntu@<PUBLIC-IP>`

### 5. Install Node.js on EC2

Once connected:

```bash
# Update system
sudo apt update
sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs npm

# Verify
node --version  # v18+
npm --version   # v9+
```

### 6. Clone Your Application

```bash
# Clone from GitHub (or upload files)
cd /home/ubuntu
git clone https://github.com/YOUR-USERNAME/shared-expense-tracker.git
cd shared-expense-tracker/backend

# OR upload files using SCP
# scp -r -i key.pem backend/* ubuntu@<IP>:~/app/backend/
```

### 7. Install Backend Dependencies

```bash
npm install
npm run db:init
```

### 8. Create Systemd Service (Auto-start)

```bash
sudo nano /etc/systemd/system/expensetracker.service
```

Paste:
```ini
[Unit]
Description=Expense Tracker Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/shared-expense-tracker/backend
Environment="NODE_ENV=production"
Environment="PORT=5000"
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl enable expensetracker
sudo systemctl start expensetracker
sudo systemctl status expensetracker
```

### 9. Install Nginx Reverse Proxy

```bash
sudo apt install -y nginx

# Edit config
sudo nano /etc/nginx/sites-available/default
```

Replace with:
```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

Restart:
```bash
sudo systemctl restart nginx
```

### 10. Setup SSL Certificate (Free)

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d yourexpense.tk
# Follow prompts
# Auto-renew enabled
```

---

## Environment Variables for Production

Create `.env`:

```
PORT=5000
NODE_ENV=production
DATABASE_PATH=/var/lib/expensetracker/app.db
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRE=7d
CORS_ORIGIN=https://yourexpense.tk
```

---

## Monitoring & Logs

```bash
# Check service status
sudo systemctl status expensetracker

# View logs
sudo journalctl -u expensetracker -f

# Check Nginx
sudo tail -f /var/log/nginx/error.log

# Restart if needed
sudo systemctl restart expensetracker
```

---

## Troubleshooting

### Port 5000 Not Accessible

```bash
# Check if service is running
sudo systemctl status expensetracker

# Check if listening
sudo netstat -tlnp | grep 5000

# Check firewall (if using security group)
# Add inbound rule: Port 5000 from anywhere
```

### Database Errors

```bash
# Check database location
ls -la /home/ubuntu/shared-expense-tracker/backend/data/

# Reinit if needed
npm run db:init
```

### Out of Memory

EC2 t2.micro has 1 GB RAM. If issues:
- Stop other services
- Use PM2 for process management

---

## Cost Monitoring

```bash
# AWS Billing Dashboard
# https://console.aws.amazon.com/billing/

# Set up budget alerts (recommended)
# CloudWatch → Alarms → Create alarm
```

---

## Maintenance

**Weekly:**
- Check logs: `sudo journalctl -u expensetracker`
- Monitor CPU/Memory: `top`

**Monthly:**
- Update Node packages: `npm audit fix`
- Update system: `sudo apt update && sudo apt upgrade`

**Certificate Auto-renews automatically!**

---

## Summary

✅ Backend running on EC2
✅ Nginx reverse proxy (HTTP/HTTPS)
✅ Auto-start service
✅ SSL certificate (free)
✅ Logs monitored
✅ Cost: $0/month (free tier)

Next: Deploy frontend to Amplify