# AWS EC2 Deployment Guide for Backend (Using EC2 Public IP)

## Prerequisites

- AWS Account (created)
- Free tier eligibility
- SSH client (built-in on Mac/Linux, PuTTY on Windows)
- An EC2 instance with a **public IPv4 address**

## Important Note: No Domain Setup

This guide is for deploying with your **EC2 public IP directly**, for example:

- Backend API: `http://18.195.147.143/api`
- Frontend API URL: `http://18.195.147.143/api`

Because you are using an IP and **not a real domain name**, skip the SSL/Certbot step for now.  
Let's Encrypt certificates are normally issued for domain names, not raw EC2 public IPs.

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
- **SSH** (Port 22)

Recommended sources:
- **HTTP (80)** → `0.0.0.0/0`
- **SSH (22)** → **Your IP only**, for example `147.161.234.84/32`

Do **not** open port `5000` publicly if you are using Nginx as the reverse proxy.

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
sudo apt install -y nodejs

# Verify
node --version  # v18+
npm --version   # v9+
```

If you previously got an `npm` package conflict, this is the fix:  
**install `nodejs` only**, because NodeSource already provides npm.

### 6. Clone Your Application

```bash
# Clone from GitHub (or upload files)
cd /home/ubuntu
git clone https://github.com/YOUR-USERNAME/Expense-Tracker.git
cd Expense-Tracker/backend

# OR upload files using SCP
# scp -r -i key.pem backend/* ubuntu@<IP>:~/app/backend/
```

### 7. Install Backend Dependencies

```bash
rm -rf node_modules package-lock.json
npm install
npm run db:init
```

This ensures Linux-native packages like `sqlite3` are built correctly on EC2.

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
WorkingDirectory=/home/ubuntu/Expense-Tracker/backend
Environment="NODE_ENV=production"
Environment="PORT=5000"
EnvironmentFile=/home/ubuntu/Expense-Tracker/backend/.env
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
    server_name 18.195.147.143;

    location = /health {
        proxy_pass http://127.0.0.1:5000/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Restart:
```bash
sudo systemctl restart nginx
```

Test it:
```bash
curl http://18.195.147.143/health
curl http://18.195.147.143/api/auth/login
```

### 10. SSL Certificate

If you are using only the EC2 public IP, **skip this step for now**.

```bash
# Skip certbot until you have a real domain name
```

If you later buy or connect a domain such as `api.yourdomain.com`, then use:

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d api.yourdomain.com
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
CORS_ORIGIN=http://18.195.147.143
APP_BASE_URL=http://18.195.147.143
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com

# Email activation
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_IGNORE_TLS=false
SMTP_USER=your-real-email@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM="Shared Expenses <your-real-email@gmail.com>"
```

If you deploy the frontend separately later, update `CORS_ORIGIN` and `APP_BASE_URL` to that frontend URL.

If you enable Google sign-in, use the same OAuth client ID in:

```bash
# Backend: /home/ubuntu/Expense-Tracker/backend/.env
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com

# Frontend build command
cd /home/ubuntu/Expense-Tracker/frontend
VITE_API_URL=http://18.195.147.143/api \
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com \
npm run build
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
```

Port `5000` does **not** need to be public.  
Only port `80` should be public, and Nginx will forward `/api` to Node internally.

Test through Nginx instead:
```bash
curl http://18.195.147.143/health
curl http://18.195.147.143/api/settlement/group/YOUR_GROUP_ID
```

### Database Errors

```bash
# Check database location
ls -la /home/ubuntu/Expense-Tracker/backend/data/

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

**If you add a domain later, then certificate auto-renew will work after Certbot setup.**

---

## Summary

✅ Backend running on EC2
✅ Nginx reverse proxy over HTTP using EC2 public IP
✅ Auto-start service
✅ Logs monitored
✅ Cost: $0/month (free tier)

Next: Deploy frontend with `VITE_API_URL=http://18.195.147.143/api`
