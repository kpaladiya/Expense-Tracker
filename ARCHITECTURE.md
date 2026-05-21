# 📚 Architecture & Code Walkthrough

## Overview

This is a **full-stack expense tracking application** for small business teams to split costs fairly.

**Tech Stack:**
- Frontend: React 18 + React Router + Tailwind CSS
- Backend: Node.js + Express.js
- Database: SQLite3
- Authentication: JWT (JSON Web Tokens)
- Hashing: bcryptjs

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (React)                        │
│  (Dashboard → Groups → Expenses → Payments → Settlement)   │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP REST API
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Express Server                           │
│  /api/auth          /api/groups      /api/settlement        │
│  /api/expenses      /api/payments    /api/...              │
└────────────────────┬────────────────────────────────────────┘
                     │ SQL Queries
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database                          │
│  users | groups | expenses | payments | group_members      │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  is_admin INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
```

**Purpose:** Stores user accounts with hashed passwords

### Groups Table
```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  admin_id TEXT,           -- FK to users
  created_at DATETIME,
  updated_at DATETIME
);
```

**Purpose:** Stores team/business groups created by admins

### Group Members Table
```sql
CREATE TABLE group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT,           -- FK to groups
  user_id TEXT,            -- FK to users
  joined_at DATETIME
);
```

**Purpose:** Many-to-many relationship between users and groups (tracks membership)

### Expenses Table
```sql
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT,           -- FK to groups
  user_id TEXT,            -- FK to users
  amount DECIMAL(10, 2),
  note TEXT,
  expense_date DATE,
  created_at DATETIME,
  updated_at DATETIME
);
```

**Purpose:** Personal spending for the business by team members

### Payments Table
```sql
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  group_id TEXT,           -- FK to groups
  user_id TEXT,            -- FK to users
  amount DECIMAL(10, 2),
  payment_method TEXT,     -- 'Cash' or 'PayPal'
  customer_note TEXT,
  payment_date DATE,
  created_at DATETIME,
  updated_at DATETIME
);
```

**Purpose:** Money received from customers

## Settlement Calculation Logic

**File:** `backend/src/utils/settlement.js`

### Algorithm:

```
function calculateSettlement(groupId):
  
  1. Get all members in group
  2. Sum expenses per user:
     totalExpenses = SUM(expenses where group_id = groupId)
  
  3. Sum payments:
     totalReceived = SUM(payments where group_id = groupId)
  
  4. Calculate profit:
     netProfit = totalReceived - totalExpenses
  
  5. Equal share:
     perPersonShare = netProfit / numberOfMembers
  
  6. For each member:
     balance = perPersonShare - amountTheySpent
     
     if balance > 0: they GET money
     if balance < 0: they OWE money
     if balance = 0: even
```

### Example:

```
Group: 3 members, "Tech Startup"

Expenses:
- User A: €100
- User B: €50
- User C: €0
Total: €150

Payments:
- €600 from customers

Calculation:
netProfit = 600 - 150 = €450
perShare = 450 / 3 = €150 each

Balances:
- User A: 150 - 100 = +€50 (gets €50)
- User B: 150 - 50 = +€100 (gets €100)
- User C: 150 - 0 = +€150 (gets €150)
```

## Backend Routes

### Authentication (`/api/auth`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/register` | Create new user account |
| POST | `/login` | Login and get JWT token |
| POST | `/logout` | Logout (invalidate token) |
| GET | `/me` | Get current user info |

### Groups (`/api/groups`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Create group (admin) |
| GET | `/` | Get all groups for user |
| GET | `/:id` | Get group details with members |
| PUT | `/:id` | Update group (admin only) |
| POST | `/:id/members` | Add user to group (admin) |
| DELETE | `/:id/members/:userId` | Remove user (admin) |

### Expenses (`/api/expenses`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Add expense |
| GET | `/group/:groupId` | Get all expenses in group |
| GET | `/:id` | Get single expense |
| PUT | `/:id` | Update own expense |
| DELETE | `/:id` | Delete own expense |

### Payments (`/api/payments`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Record payment |
| GET | `/group/:groupId` | Get all payments in group |
| GET | `/:id` | Get single payment |
| PUT | `/:id` | Update own payment |
| DELETE | `/:id` | Delete own payment |

### Settlement (`/api/settlement`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/group/:groupId` | Calculate and return settlement |

## Frontend Components

### App Structure

```
App.jsx
├── AuthProvider (context)
├── Routes
│   ├── LoginPage
│   ├── DashboardPage (protected)
│   ├── GroupDetailPage (protected)
│   └── CreateGroupPage (protected)
└── AuthContext (authentication state)
```

### Key Components

**LoginPage.jsx**
- Login and registration form
- Demo credentials for testing
- Error handling

**DashboardPage.jsx**
- List all user's groups
- Quick stats (received, spent, profit)
- Create group button
- Card layout for each group

**GroupDetailPage.jsx**
- Tabbed interface (Overview, Expenses, Payments, Settlement)
- Group stats and member list
- Group settings (admin only)

**CreateGroupPage.jsx**
- Form to create new group
- Name and description input
- Validation and error handling

### Services

**api.js**
- Centralized API calls
- Token management
- Error handling

**AuthContext.jsx**
- Authentication state management
- Login/register/logout functions
- User persistence

## Authentication Flow

```
User fills login form
    ↓
POST /api/auth/login
    ↓
Backend validates credentials
    ↓
Backend hashes password and compares with stored hash
    ↓
IF match: create JWT token
    ↓
Return token to frontend
    ↓
Frontend stores token in localStorage
    ↓
All API requests include: Authorization: Bearer TOKEN
    ↓
Backend middleware verifies token
    ↓
Request proceeds or is rejected
```

## Security Features

1. **Password Hashing**
   - Uses bcryptjs (10 salt rounds)
   - Passwords never stored in plaintext
   - File: `backend/src/routes/auth.js`

2. **JWT Tokens**
   - Signed with secret key
   - Contains: userId, email, name, isAdmin
   - Expires after 7 days
   - File: `backend/src/middleware/auth.js`

3. **CORS Protection**
   - Only localhost:5173 allowed in dev
   - Change CORS_ORIGIN in .env for production

4. **Access Control**
   - Users can only see/modify their own data
   - Only group admins can manage members
   - Only expense/payment creators can delete own records

## How to Read the Code

### Start with Backend

1. **`backend/src/server.js`**
   - Entry point
   - Server setup
   - Route registration

2. **`backend/src/db/schema.sql`**
   - Understand database structure
   - See relationships between tables

3. **`backend/src/utils/settlement.js`**
   - Core calculation logic
   - Most important business logic

4. **`backend/src/routes/auth.js`**
   - How authentication works
   - Token generation

5. **`backend/src/routes/groups.js`**
   - Group management
   - Member operations

### Then Frontend

1. **`frontend/src/App.jsx`**
   - Routing structure
   - Entry point

2. **`frontend/src/services/AuthContext.jsx`**
   - State management
   - Authentication logic

3. **`frontend/src/pages/LoginPage.jsx`**
   - How to call API
   - Form handling

4. **`frontend/src/pages/DashboardPage.jsx`**
   - Data loading
   - Component composition

## Key Concepts

### UUID (Unique Identifiers)
- Used for all IDs (users, groups, expenses, etc.)
- `import { v4 as uuidv4 } from 'uuid'`
- Example: `6ba7b810-9dad-11d1-80b4-00c04fd430c8`

### JWT (JSON Web Tokens)
```
Header.Payload.Signature

Example:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyIsIm5hbWUiOiJKb2huIn0.signature
```

### Environment Variables
- Stored in `.env` file
- Not committed to git
- Accessed via `process.env.VARIABLE_NAME`

### REST API Conventions

```
GET    /api/resource        → Get all items
GET    /api/resource/:id    → Get single item
POST   /api/resource        → Create new item
PUT    /api/resource/:id    → Update item
DELETE /api/resource/:id    → Delete item
```

## Testing Workflow

1. **Login with demo account**
   - `admin@example.com` / `admin123`

2. **View Dashboard**
   - Should see "Tech Startup" group
   - Shows stats from sample data

3. **Click on Group**
   - See group details
   - View members

4. **Go to Settlement Tab**
   - See calculation breakdown
   - Verify math is correct

5. **Add New Expense**
   - Create own expense
   - Verify it appears in list
   - Check settlement recalculates

6. **Record Payment**
   - Add customer payment
   - Verify settlement updates

## Common Modifications

### Change Database Location
Edit `backend/.env`:
```
DATABASE_PATH=/path/to/custom/location/app.db
```

### Change API Port
Edit `backend/.env`:
```
PORT=3000
```

### Change Frontend URL
Edit `backend/.env`:
```
CORS_ORIGIN=http://yourdomain.com:3000
```

### Change JWT Expiry
Edit `backend/.env`:
```
JWT_EXPIRE=30d
```

### Modify Settlement Logic
Edit `backend/src/utils/settlement.js`:
- Change how profit is divided
- Add expense categories
- Add custom calculations

### Add New API Endpoint

1. Create route file in `backend/src/routes/feature.js`
2. Export router
3. Register in `backend/src/server.js`:
   ```javascript
   import featureRoutes from './routes/feature.js';
   app.use('/api/feature', featureRoutes);
   ```

### Add New React Page

1. Create file in `frontend/src/pages/NewPage.jsx`
2. Add route in `frontend/src/App.jsx`:
   ```javascript
   <Route path="/new-page" element={<ProtectedRoute><NewPage /></ProtectedRoute>} />
   ```
3. Navigate to it from another page:
   ```javascript
   import { useNavigate } from 'react-router-dom';
   const navigate = useNavigate();
   navigate('/new-page');
   ```

## Performance Tips

1. **Database Indexes**
   - Already added for group_id and user_id
   - Queries are optimized

2. **Settlement Caching**
   - Currently recalculates on each request
   - Could cache in production

3. **Pagination**
   - Not needed for small datasets
   - Add LIMIT/OFFSET if needed

4. **Frontend Optimization**
   - Uses React lazy loading
   - No unnecessary re-renders

## Debugging Tips

### Backend Debugging

```javascript
// Add console logs
console.log('User:', user);
console.log('Settlement:', settlement);

// Check what's in request
console.log(req.body);
console.log(req.params);
```

### Frontend Debugging

```javascript
// Open browser console (F12)
// Check for API errors
// Use React DevTools extension

// Inspect localStorage
localStorage.getItem('token');

// Check network tab
// See API calls and responses
```

### Database Debugging

```bash
sqlite3 backend/data/app.db
SELECT * FROM users;
SELECT * FROM groups;
SELECT * FROM expenses WHERE group_id = 'xxx';
```

---

This application demonstrates full-stack development best practices with clear separation of concerns, proper security, and scalable architecture.

**Happy coding! 🚀**