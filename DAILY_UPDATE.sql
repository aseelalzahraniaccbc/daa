-- ══════════════════════════════════════════════════════════════
-- DAILY UPDATE (UTF-8 fix — no FK constraints)
-- CODEPAGE='65001' fixes the ΓÇô dash display issue
-- ══════════════════════════════════════════════════════════════


-- ══ STEP 1: APPEND SALES ══
DROP TABLE IF EXISTS #TempSales;
CREATE TABLE #TempSales ([Customer Code] NVARCHAR(50),[Salesman Code] NVARCHAR(50),[PK_ProductID] NVARCHAR(50),[Supervisor Code] NVARCHAR(50),[Route Code] NVARCHAR(50),[DayDate] NVARCHAR(20),[ACH CY (P)] DECIMAL(18,2),[ACH LY (P)] DECIMAL(18,2),[ACT-CY] DECIMAL(18,2),[ACT-LY] DECIMAL(18,2));
BULK INSERT #TempSales FROM 'Sales.csv' WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK, BATCHSIZE=50000, CODEPAGE='65001');
UPDATE #TempSales SET [Customer Code]=LTRIM(RTRIM([Customer Code])), [Salesman Code]=LTRIM(RTRIM([Salesman Code])), [PK_ProductID]=LTRIM(RTRIM([PK_ProductID]));
INSERT INTO Sales ([Customer Code],[Salesman Code],[PK_ProductID],[Supervisor Code],[Route Code],[DayDate],[ACH CY (P)],[ACH LY (P)],[ACT-CY],[ACT-LY])
SELECT * FROM #TempSales;
DROP TABLE #TempSales;
PRINT '>> Step 1: Sales appended';
SELECT 'Sales' AS [Table], COUNT(*) AS [Total Rows] FROM Sales;


-- ══ STEP 2: REPLACE SALESMENDATA ══
DELETE FROM SalesmenData;
DBCC CHECKIDENT ('SalesmenData', RESEED, 0);
DROP TABLE IF EXISTS #TempSM;
CREATE TABLE #TempSM ([Salesman Code] NVARCHAR(20),[Salesman] NVARCHAR(100),[Assigned SUP] NVARCHAR(20),[Route Code] NVARCHAR(20),[TGT] DECIMAL(18,2),[ACT-CY] DECIMAL(18,2),[%TGT] DECIMAL(8,2));
BULK INSERT #TempSM FROM 'Salesmendata.csv' WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK, CODEPAGE='65001');
INSERT INTO SalesmenData ([Salesman Code],[Salesman],[Assigned SUP],[Route Code],[TGT],[ACT-CY],[%TGT]) SELECT * FROM #TempSM;
DROP TABLE #TempSM;
UPDATE SalesmenData SET [Salesman Code]=LTRIM(RTRIM([Salesman Code])), [Assigned SUP]=LTRIM(RTRIM([Assigned SUP]));
PRINT '>> Step 2: SalesmenData replaced';
SELECT 'SalesmenData' AS [Table], COUNT(*) AS [Total Rows] FROM SalesmenData;


-- ══ STEP 3: REPLACE SUPDATA ══
DELETE FROM SUPdata;
DBCC CHECKIDENT ('SUPdata', RESEED, 0);
DROP TABLE IF EXISTS #TempSUP;
CREATE TABLE #TempSUP ([Supervisor Code] NVARCHAR(20),[Supervisor] NVARCHAR(100),[Route Code] NVARCHAR(20),[AssignedBSM] NVARCHAR(20),[TGT] DECIMAL(18,2),[ACT-CY] DECIMAL(18,2),[%TGT] DECIMAL(8,2));
BULK INSERT #TempSUP FROM 'SUPdata.csv' WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK, CODEPAGE='65001');
INSERT INTO SUPdata ([Supervisor Code],[Supervisor],[Route Code],[AssignedBSM],[TGT],[ACT-CY],[%TGT]) SELECT * FROM #TempSUP;
DROP TABLE #TempSUP;
UPDATE SUPdata SET [Supervisor Code]=LTRIM(RTRIM([Supervisor Code])), [AssignedBSM]=LTRIM(RTRIM([AssignedBSM]));
PRINT '>> Step 3: SUPdata replaced';
SELECT 'SUPdata' AS [Table], COUNT(*) AS [Total Rows] FROM SUPdata;


-- ══ STEP 4: REPLACE BSMDATA ══
DELETE FROM BSMdata;
DBCC CHECKIDENT ('BSMdata', RESEED, 0);
DROP TABLE IF EXISTS #TempBSM;
CREATE TABLE #TempBSM ([BSM Code] NVARCHAR(20),[Branch Manager] NVARCHAR(100),[Sector] NVARCHAR(100),[Branch] NVARCHAR(100),[TGT] DECIMAL(18,2),[ACT-CY] DECIMAL(18,2),[%TGT] DECIMAL(8,2));
BULK INSERT #TempBSM FROM 'BSMdata.csv' WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK, CODEPAGE='65001');
INSERT INTO BSMdata ([BSM Code],[Branch Manager],[Sector],[Branch],[TGT],[ACT-CY],[%TGT]) SELECT * FROM #TempBSM;
DROP TABLE #TempBSM;
UPDATE BSMdata SET [BSM Code]=LTRIM(RTRIM([BSM Code]));
PRINT '>> Step 4: BSMdata replaced';
SELECT 'BSMdata' AS [Table], COUNT(*) AS [Total Rows] FROM BSMdata;


-- ══ STEP 5: UPDATE STATISTICS ══
UPDATE STATISTICS Sales WITH FULLSCAN;
UPDATE STATISTICS SalesmenData WITH FULLSCAN;
UPDATE STATISTICS SUPdata WITH FULLSCAN;
UPDATE STATISTICS BSMdata WITH FULLSCAN;


-- ══ STEP 6: DATA QUALITY CHECK ══
SELECT 'Blank Customer Code' AS [Check], COUNT(*) AS [Count]
FROM Sales WHERE [Customer Code] IS NULL OR LTRIM(RTRIM([Customer Code])) = ''
UNION ALL
SELECT 'No Customer Match', COUNT(*)
FROM Sales s LEFT JOIN Customers c ON s.[Customer Code] = c.[Customer Code] WHERE c.[Customer Code] IS NULL
UNION ALL
SELECT 'Blank Product ID', COUNT(*)
FROM Sales WHERE [PK_ProductID] IS NULL OR LTRIM(RTRIM([PK_ProductID])) = ''
UNION ALL
SELECT 'No Product Match', COUNT(*)
FROM Sales s LEFT JOIN Products p ON s.[PK_ProductID] = p.[PK_ProductID] WHERE p.[PK_ProductID] IS NULL
UNION ALL
SELECT 'Blank Customer Name', COUNT(*)
FROM Customers WHERE [Customer] IS NULL OR LTRIM(RTRIM([Customer])) = '';

PRINT '>> ALL DONE - Now clear cache:';
PRINT '>> https://salesap-g4ceg7arc2bkbvfx.centralus-01.azurewebsites.net/api/api?action=clearCache';
