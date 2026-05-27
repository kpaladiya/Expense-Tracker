 cd ~/Expense-Tracker
 
 # 1) Backup local runtime files
 mkdir -p ~/server-local-backup
 cp backend/.env ~/server-local-backup/.env.$(date +%F-%H%M%S)
 cp backend/data/app.db ~/server-local-backup/app.db.$(date +%F-%H%M%S)
 
 # 2) Clean only the files blocking pull
 git restore backend/.env backend/data/app.db backend/node_modules/.package-lock.json frontend/dist/index.html
 
 # 3) Pull latest code
 git pull --ff-only
 
 # 4) Restore server-specific config and data
 cp ~/server-local-backup/.env.* backend/.env
 cp ~/server-local-backup/app.db.* backend/data/app.db

Then continue deploy:

 cd backend
 npm ci --omit=dev
 sudo systemctl restart expensetracker
 
 cd ../frontend
 VITE_API_URL=https://18-195-147-143.nip.io/api \
 VITE_GOOGLE_CLIENT_ID=99498625150-1as9jrila08ut3jv8fjcajg060j2bhk1.apps.googleusercontent.com \
 npm run build
 sudo rsync -a --delete dist/ /var/www/expense-tracker/
 sudo systemctl reload nginx