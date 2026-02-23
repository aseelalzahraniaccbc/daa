-- ══════════════════════════════════════════════════════════════
-- BULK IMPORT v3 — Fixed for IDENTITY columns
-- 
-- For tables WITH auto-ID: use a temp table without ID,
-- bulk insert into temp, then INSERT INTO real table
-- ══════════════════════════════════════════════════════════════

-- ══ SECTION 1: Credentials (skip if already done) ══
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'SalesPortal2026!Secure';
GO

IF EXISTS (SELECT * FROM sys.database_scoped_credentials WHERE name = 'BlobCredential')
    DROP DATABASE SCOPED CREDENTIAL BlobCredential;
CREATE DATABASE SCOPED CREDENTIAL BlobCredential
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = 'sv=2024-11-04&ss=bfqt&srt=o&sp=rwdlacupiytfx&se=2027-02-19T15:34:14Z&st=2026-02-19T07:19:14Z&spr=https&sig=H%2B5eBsC0B5IvF4Ys7bOXJXTaR6ZYylMc%2Bx8iW1VFxc0%3D';
GO

IF EXISTS (SELECT * FROM sys.external_data_sources WHERE name = 'BlobStorage')
    DROP EXTERNAL DATA SOURCE BlobStorage;
CREATE EXTERNAL DATA SOURCE BlobStorage
WITH (TYPE = BLOB_STORAGE, LOCATION = 'https://ndjat.blob.core.windows.net/imports', CREDENTIAL = BlobCredential);
GO


-- ══ SECTION 2: Import Users (no ID column — direct insert) ══
BULK INSERT Users
FROM 'users.csv'
WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK);
SELECT 'Users' AS Imported, COUNT(*) AS Rows FROM Users;


-- ══ SECTION 3: Import SalesmenData ══
DROP TABLE IF EXISTS #TempSM;
CREATE TABLE #TempSM (
    [Salesman Code] NVARCHAR(20),
    [Salesman] NVARCHAR(100),
    [Assigned SUP] NVARCHAR(20),
    [Route Code] NVARCHAR(20),
    [TGT] DECIMAL(18,2),
    [ACT-CY] DECIMAL(18,2),
    [%TGT] DECIMAL(8,2)
);
BULK INSERT #TempSM
FROM 'Salesmendata.csv'
WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK);

INSERT INTO SalesmenData ([Salesman Code],[Salesman],[Assigned SUP],[Route Code],[TGT],[ACT-CY],[%TGT])
SELECT * FROM #TempSM;
DROP TABLE #TempSM;
SELECT 'SalesmenData' AS Imported, COUNT(*) AS Rows FROM SalesmenData;


-- ══ SECTION 4: Import SUPdata ══
DROP TABLE IF EXISTS #TempSUP;
CREATE TABLE #TempSUP (
    [Supervisor Code] NVARCHAR(20),
    [Supervisor] NVARCHAR(100),
    [Route Code] NVARCHAR(20),
    [AssignedBSM] NVARCHAR(20),
    [TGT] DECIMAL(18,2),
    [ACT-CY] DECIMAL(18,2),
    [%TGT] DECIMAL(8,2)
);
BULK INSERT #TempSUP
FROM 'SUPdata.csv'
WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK);

INSERT INTO SUPdata ([Supervisor Code],[Supervisor],[Route Code],[AssignedBSM],[TGT],[ACT-CY],[%TGT])
SELECT * FROM #TempSUP;
DROP TABLE #TempSUP;
SELECT 'SUPdata' AS Imported, COUNT(*) AS Rows FROM SUPdata;


-- ══ SECTION 5: Import BSMdata ══
DROP TABLE IF EXISTS #TempBSM;
CREATE TABLE #TempBSM (
    [BSM Code] NVARCHAR(20),
    [Branch Manager] NVARCHAR(100),
    [Sector] NVARCHAR(100),
    [Branch] NVARCHAR(100),
    [TGT] DECIMAL(18,2),
    [ACT-CY] DECIMAL(18,2),
    [%TGT] DECIMAL(8,2)
);
BULK INSERT #TempBSM
FROM 'BSMdata.csv'
WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK);

INSERT INTO BSMdata ([BSM Code],[Branch Manager],[Sector],[Branch],[TGT],[ACT-CY],[%TGT])
SELECT * FROM #TempBSM;
DROP TABLE #TempBSM;
SELECT 'BSMdata' AS Imported, COUNT(*) AS Rows FROM BSMdata;


-- ══ SECTION 6: Import MasterData (150K rows) ══
DROP TABLE IF EXISTS #TempMD;
CREATE TABLE #TempMD (
    [Supervisor Code] NVARCHAR(20),
    [Salesman Code] NVARCHAR(20),
    [Branch Manager] NVARCHAR(100),
    [Route Code] NVARCHAR(20),
    [Customer Code] NVARCHAR(50),
    [Customer] NVARCHAR(200),
    [Sector] NVARCHAR(100),
    [Class] NVARCHAR(100),
    [Region] NVARCHAR(100),
    [Branch] NVARCHAR(100),
    [Brand] NVARCHAR(100),
    [Product Group] NVARCHAR(100),
    [Sub Brand] NVARCHAR(100),
    [Product] NVARCHAR(200),
    [Date] DATE,
    [L3S] DECIMAL(18,2),
    [L6S] DECIMAL(18,2),
    [ACH CY (P)] DECIMAL(18,2),
    [ACH LY (P)] DECIMAL(18,2),
    [ACT-CY] DECIMAL(18,2),
    [ACT-LY] DECIMAL(18,2)
);
BULK INSERT #TempMD
FROM 'MasterData.csv'
WITH (DATA_SOURCE='BlobStorage', FORMAT='CSV', FIRSTROW=2, FIELDTERMINATOR=',', ROWTERMINATOR='0x0a', TABLOCK, BATCHSIZE=50000);

INSERT INTO MasterData ([Supervisor Code],[Salesman Code],[Branch Manager],[Route Code],[Customer Code],[Customer],[Sector],[Class],[Region],[Branch],[Brand],[Product Group],[Sub Brand],[Product],[Date],[L3S],[L6S],[ACH CY (P)],[ACH LY (P)],[ACT-CY],[ACT-LY])
SELECT * FROM #TempMD;
DROP TABLE #TempMD;
SELECT 'MasterData' AS Imported, COUNT(*) AS Rows FROM MasterData;


-- ══ SECTION 7: Verify all ══
SELECT 'Users' AS T, COUNT(*) AS Rows FROM Users
UNION ALL SELECT 'SalesmenData', COUNT(*) FROM SalesmenData
UNION ALL SELECT 'SUPdata', COUNT(*) FROM SUPdata
UNION ALL SELECT 'BSMdata', COUNT(*) FROM BSMdata
UNION ALL SELECT 'MasterData', COUNT(*) FROM MasterData;