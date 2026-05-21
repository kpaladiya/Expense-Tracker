# 💰 Shared Expense Tracker

A simple web app for small business teams to track shared expenses and customer payments, then automatically split profits equally.

## Features

- ✅ **User Authentication** - Admin and regular user login
- ✅ **Group Management** - Admins create teams and invite users
- ✅ **Expense Tracking** - Team members log personal business expenses
- ✅ **Payment Tracking** - Record customer payments (Cash/PayPal)
- ✅ **Automatic Settlement** - Calculate equal profit shares and balances
- ✅ **Dashboard** - Real-time overview of totals and balances
- ✅ **Mobile-Friendly** - Responsive design for all devices
- ✅ **Simple & Clean** - Minimal UI, easy to understand

## Tech Stack

- **Frontend**: React + TailwindCSS
- **Backend**: Node.js + Express
- **Database**: SQLite
- **API**: REST

## Project Structure

```
shared-expense-tracker/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   └── init.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── groups.js
│   │   │   ├── expenses.js
│   │   │   ├── payments.js
│   │   │   └── settlement.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   ├── utils/
│   │   │   └── settlement.js
│   │   └── server.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── index.css
│   ├── public/
│   ├── package.json
│   └── vite.config.js
└── README.md (this file)
```

## Quick Start

### Prerequisites

- Node.js v18+
- npm or yarn

### Backend Setup

1. **Navigate to backend directory**
```bash
cd backend
npm install
```

2. **Create .env file**
```bash
cp .env.example .env
```

3. **Initialize database**
```bash
npm run db:init
```

4. **Start backend server**
```bash
npm run dev
```

Backend runs on `http://localhost:5000`

### Frontend Setup

1. **Navigate to frontend directory**
```bash
cd frontend
npm install
```

2. **Start development server**
```bash
npm run dev
```

Frontend runs on `http://localhost:5173`

## Default Credentials

The database comes pre-populated with sample data:

**Admin Account**
- Email: `admin@example.com`
- Password: `admin123`

**Regular Users**
- User A: `usera@example.com` / `password123`
- User B: `userb@example.com` / `password123`
- User C: `userc@example.com` / `password123`

**Sample Data**
- Group: "Tech Startup"
- Expenses and payments already recorded
- Settlement calculations ready to view

## API Documentation

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout

### Groups
- `POST /api/groups` - Create group (admin only)
- `GET /api/groups` - Get user's groups
- `GET /api/groups/:id` - Get group details
- `POST /api/groups/:id/members` - Add user to group (admin only)
- `DELETE /api/groups/:id/members/:userId` - Remove user (admin only)

### Expenses
- `POST /api/expenses` - Add expense
- `GET /api/expenses/group/:groupId` - Get group expenses
- `DELETE /api/expenses/:id` - Delete expense (own only)

### Payments
- `POST /api/payments` - Record payment
- `GET /api/payments/group/:groupId` - Get group payments
- `DELETE /api/payments/:id` - Delete payment (own only)

### Settlement
- `GET /api/settlement/group/:groupId` - Get settlement calculation

## Settlement Logic Explained

1. **Collect All Expenses** - Sum what each user spent
2. **Collect All Payments** - Sum customer money received
3. **Calculate Net Profit** - Total Payments - Total Expenses
4. **Divide Equally** - Net Profit ÷ Number of Users
5. **Calculate Per-User Balance**:
   - Each user gets their equal share
   - Subtract what they spent (they'll be reimbursed)
   - Result shows who owes money or gets money

**Example Calculation:**
```
User A spent: €100
User B spent: €50
User C spent: €0
Total Expenses: €150

Customer Payments: €600

Net Profit: €600 - €150 = €450
Per Person Share: €450 ÷ 3 = €150

User A: €150 (profit share) - €100 (spent) = €50 (gets €50)
User B: €150 (profit share) - €50 (spent) = €100 (gets €100)
User C: €150 (profit share) - €0 (spent) = €150 (gets €150)
```

## Features Walkthrough

### 1. Login
- Simple login with email and password
- Admin gets admin dashboard
- Regular users get regular dashboard

### 2. Dashboard
- Overview of total received, expenses, net profit
- List of all members and their balances
- Quick stats and charts

### 3. Add Expense
- Enter amount, note, date
- Automatically assigned to logged-in user
- Visible in group expense list

### 4. Record Payment
- Enter amount received from customers
- Choose payment method (Cash or PayPal)
- Add customer note
- Recorded with date

### 5. Settlement Summary
- Shows total spent per user
- Shows equal profit share
- Shows final balance (who gets what)
- Color-coded: red for owing, green for receiving

### 6. Admin: Manage Users
- View all group members
- Add new users to group
- Remove users from group
- Edit group details

## Development Notes

### Database
- SQLite file: `backend/data/app.db`
- Schema: `backend/src/db/schema.sql`
- Auto-initialized on first run

### API Response Format
All endpoints return JSON:
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Success message"
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error message"
}
```

### Authentication
- JWT tokens in localStorage
- Auth middleware on protected routes
- Auto-logout on token expiry

## Troubleshooting

### Port already in use
Backend: `sudo lsof -i :5000` then `kill -9 <PID>`
Frontend: `sudo lsof -i :5173` then `kill -9 <PID>`

### Database locked
Delete `backend/data/app.db` and reinitialize: `npm run db:init`

### CORS errors
Check `.env` CORS settings match frontend URL

### Can't login
Make sure database is initialized: `npm run db:init`
Check sample user credentials above

## Future Enhancements

- [ ] Email notifications
- [ ] Multiple groups per user
- [ ] Expense categories
- [ ] Monthly settlements
- [ ] CSV export
- [ ] Two-factor authentication
- [ ] Real payment integration (Stripe)
- [ ] Mobile app (React Native)
- [ ] User avatars
- [ ] Transaction history

## License

MIT - Feel free to use and modify

## Support

For issues or questions, check the code comments or create an issue in the repository.

---

**Built with ❤️ for small business teams**