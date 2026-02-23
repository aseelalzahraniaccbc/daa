# Azure Setup Guide — Sales Portal v9

## Overview
```
Browser (GitHub Pages) → Azure Function (API) → Azure SQL Database
                       → Power Automate (Surveys only — unchanged)
```

## Step 1: Create Azure SQL Database (you already have this)
- Your server should already exist from earlier setup
- Run `01_SQL_TABLES.sql` in Query Editor to create the new tables

## Step 2: Import Data
1. Save each Excel tab as CSV (UTF-8):
   - `users.csv` — Headers: User Code,User Name,Role
   - `salesmen_data.csv` — Headers: Salesman Code,Salesman,Assigned SUP,Route Code,TGT,ACT-CY,%TGT
   - `sup_data.csv` — Headers: Supervisor Code,Supervisor,Route Code,AssignedBSM,TGT,ACT-CY,%TGT
   - `bsm_data.csv` — Headers: BSM Code,Branch Manager,Sector,Branch,TGT,ACT-CY,%TGT
   - `master_data.csv` — Headers: Supervisor Code,Salesman Code,Branch Manager,Route Code,Customer Code,Customer,Sector,Class,Region,Branch,Brand,Product Group,Sub Brand,Product,Date,L3S,L6S,ACH CY (P),ACH LY (P),ACT-CY,ACT-LY

2. Upload CSVs to your `ndjat` storage account → `imports` container
3. Run `02_BULK_IMPORT.sql` section by section in Query Editor

## Step 3: Create Azure Function App
1. Azure Portal → Search "Function App" → Create
2. Settings:
   - Runtime: Node.js 18+
   - Plan: Consumption (Serverless) — FREE tier
   - Region: Same as your database
3. After creation, go to the Function App
4. Settings → Configuration → Application settings → New:
   - Name: `SQL_CONNECTION_STRING`
   - Value: Your connection string from SQL Database → Connection strings
     Format: `Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=YOUR_DB;Persist Security Info=False;User ID=YOUR_USER;Password=YOUR_PASSWORD;MultipleActiveResultSets=False;Encrypt=true;TrustServerCertificate=False;Connection Timeout=30;`
5. Settings → CORS → Add: `*` (or your GitHub Pages URL)

## Step 4: Deploy the Function
1. In your Function App → Functions → Create → HTTP trigger
2. Name: `api`
3. Authorization level: Anonymous
4. After creation:
   - Go to "Code + Test"
   - Replace index.js with `03_AZURE_FUNCTION.js` content
   - Upload `04_package.json` as package.json
   - Open Console tab → run: `cd /home/site/wwwroot/api && npm install`
5. Test URL: `https://YOUR-FUNCTION.azurewebsites.net/api/api?action=login&code=YOUR_USER_CODE`

## Step 5: Update HTML Files
1. Copy the Function URL (without parameters)
2. Open each HTML file and paste it as `AZURE_API_URL`
3. Upload to GitHub

## Step 6: Test
1. Open your portal
2. Login with a real User Code
3. Check console (F12) — should show "Azure API response keys: ..."

## Performance Comparison
| Method          | 150K rows load time |
|----------------|-------------------|
| Google Sheets   | 30-60 seconds     |
| Apps Script     | 10-30 seconds     |
| Azure SQL       | < 1 second        |
