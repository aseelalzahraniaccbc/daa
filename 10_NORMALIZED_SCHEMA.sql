-- ══════════════════════════════════════════════════════════════
-- SALES PORTAL v10 — NORMALIZED DATABASE SCHEMA
-- Run in Azure Portal → Query Editor (step by step)
-- ══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════
-- STEP 1: CREATE NEW TABLES
-- ══════════════════════════════════════════════════

-- Customers lookup table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Customers')
CREATE TABLE Customers (
    [Customer Code]   NVARCHAR(50)  NOT NULL,
    [Customer]        NVARCHAR(200) NULL,
    [Sector]          NVARCHAR(100) NULL,
    [Class]           NVARCHAR(50)  NULL,
    [Region]          NVARCHAR(100) NULL,
    [Branch]          NVARCHAR(100) NULL,
    CONSTRAINT PK_Customers PRIMARY KEY ([Customer Code])
);

-- Products lookup table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
CREATE TABLE Products (
    [PK_ProductID]    NVARCHAR(50)  NOT NULL,
    [Brand]           NVARCHAR(100) NULL,
    [Product Group]   NVARCHAR(100) NULL,
    [Sub Brand]       NVARCHAR(100) NULL,
    [Product]         NVARCHAR(200) NULL,
    CONSTRAINT PK_Products PRIMARY KEY ([PK_ProductID])
);

-- Sales fact table (thin — numbers + foreign keys only)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Sales')
CREATE TABLE Sales (
    [ID]              INT IDENTITY(1,1) PRIMARY KEY,
    [Customer Code]   NVARCHAR(50)  NOT NULL,
    [Salesman Code]   NVARCHAR(50)  NOT NULL,
    [PK_ProductID]    NVARCHAR(50)  NOT NULL,
    [Supervisor Code] NVARCHAR(50)  NULL,
    [Route Code]      NVARCHAR(50)  NULL,
    [DayDate]         NVARCHAR(20)  NULL,
    [ACH CY (P)]      FLOAT         NULL DEFAULT 0,
    [ACH LY (P)]      FLOAT         NULL DEFAULT 0,
    [L3S]             FLOAT         NULL DEFAULT 0,
    [L6S]             FLOAT         NULL DEFAULT 0,
    [ACT-CY]          FLOAT         NULL DEFAULT 0,
    [ACT-LY]          FLOAT         NULL DEFAULT 0
);

-- Pre-aggregated customer summary (auto-refreshed)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CustomerSummary')
CREATE TABLE CustomerSummary (
    [Customer Code]   NVARCHAR(50)  NOT NULL,
    [Customer]        NVARCHAR(200) NULL,
    [Salesman Code]   NVARCHAR(50)  NULL,
    [Salesman]        NVARCHAR(200) NULL,
    [Supervisor Code] NVARCHAR(50)  NULL,
    [Route Code]      NVARCHAR(50)  NULL,
    [Sector]          NVARCHAR(100) NULL,
    [Class]           NVARCHAR(50)  NULL,
    [Region]          NVARCHAR(100) NULL,
    [Branch]          NVARCHAR(100) NULL,
    [TotalL3S]        FLOAT         NULL DEFAULT 0,
    [TotalL6S]        FLOAT         NULL DEFAULT 0,
    [TotalCY]         FLOAT         NULL DEFAULT 0,
    [TotalLY]         FLOAT         NULL DEFAULT 0,
    [TotalACHCY]      FLOAT         NULL DEFAULT 0,
    [TotalACHLY]      FLOAT         NULL DEFAULT 0,
    [Cnt]             INT           NULL DEFAULT 0,
    [VarPct]          FLOAT         NULL DEFAULT 0,
    [LastRefresh]     DATETIME      NULL DEFAULT GETDATE(),
    CONSTRAINT PK_CustomerSummary PRIMARY KEY ([Customer Code])
);

PRINT '>> Step 1 complete: Tables created';


-- ══════════════════════════════════════════════════
-- STEP 2: IMPORT CSV FILES
-- ══════════════════════════════════════════════════
-- Use Azure Portal → Query Editor → Import button
-- Import order: 1) Customers  2) Products  3) Sales
--
-- IMPORTANT: When importing Sales CSV, make sure:
--   - The ID column auto-generates (don't include in CSV)
--   - Map CSV columns to table columns correctly
--
-- After import, run Step 3 below.
-- ══════════════════════════════════════════════════


-- ══════════════════════════════════════════════════
-- STEP 3: CREATE INDEXES (run AFTER data import)
-- ══════════════════════════════════════════════════

-- Sales: main aggregation query (by Salesman, grouped by Customer)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Sales_SM_Cust')
CREATE NONCLUSTERED INDEX IX_Sales_SM_Cust
ON Sales([Salesman Code], [Customer Code])
INCLUDE ([ACT-CY], [ACT-LY], [L3S], [L6S], [ACH CY (P)], [ACH LY (P)],
         [PK_ProductID], [Route Code], [Supervisor Code], [DayDate]);

-- Sales: BSM direct management filter
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Sales_Supervisor')
CREATE NONCLUSTERED INDEX IX_Sales_Supervisor
ON Sales([Supervisor Code])
INCLUDE ([Customer Code], [Salesman Code]);

-- Sales: customer detail page (one customer's rows)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Sales_Customer')
CREATE NONCLUSTERED INDEX IX_Sales_Customer
ON Sales([Customer Code])
INCLUDE ([Salesman Code], [PK_ProductID], [Supervisor Code], [Route Code],
         [DayDate], [ACT-CY], [ACT-LY], [L3S], [L6S], [ACH CY (P)], [ACH LY (P)]);

-- CustomerSummary: BSM/Supervisor login queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CS_Salesman')
CREATE NONCLUSTERED INDEX IX_CS_Salesman
ON CustomerSummary([Salesman Code])
INCLUDE ([Customer Code], [Customer], [Route Code], [Sector], [Class],
         [TotalCY], [TotalLY], [TotalL3S], [TotalL6S], [VarPct]);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CS_Supervisor')
CREATE NONCLUSTERED INDEX IX_CS_Supervisor
ON CustomerSummary([Supervisor Code]);

PRINT '>> Step 3 complete: Indexes created';


-- ══════════════════════════════════════════════════
-- STEP 4: REFRESH CUSTOMER SUMMARY
-- *** Run this after EVERY data import/update ***
-- ══════════════════════════════════════════════════

TRUNCATE TABLE CustomerSummary;

INSERT INTO CustomerSummary (
    [Customer Code], [Customer], [Salesman Code], [Salesman],
    [Supervisor Code], [Route Code],
    [Sector], [Class], [Region], [Branch],
    [TotalL3S], [TotalL6S], [TotalCY], [TotalLY],
    [TotalACHCY], [TotalACHLY], [Cnt], [VarPct], [LastRefresh]
)
SELECT
    s.[Customer Code],
    c.[Customer],
    s.[Salesman Code],
    sm.[Salesman],
    MAX(s.[Supervisor Code]),
    MAX(s.[Route Code]),
    c.[Sector],
    c.[Class],
    c.[Region],
    c.[Branch],
    ISNULL(SUM(s.[L3S]), 0),
    ISNULL(SUM(s.[L6S]), 0),
    ISNULL(SUM(s.[ACT-CY]), 0),
    ISNULL(SUM(s.[ACT-LY]), 0),
    ISNULL(SUM(s.[ACH CY (P)]), 0),
    ISNULL(SUM(s.[ACH LY (P)]), 0),
    COUNT(*),
    CASE
        WHEN ISNULL(SUM(s.[ACT-LY]), 0) = 0 THEN 0
        ELSE (SUM(s.[ACT-CY]) - SUM(s.[ACT-LY])) / SUM(s.[ACT-LY]) * 100
    END,
    GETDATE()
FROM Sales s
LEFT JOIN Customers c
    ON LTRIM(RTRIM(s.[Customer Code])) = LTRIM(RTRIM(c.[Customer Code]))
LEFT JOIN SalesmenData sm
    ON LTRIM(RTRIM(s.[Salesman Code])) = LTRIM(RTRIM(sm.[Salesman Code]))
GROUP BY
    s.[Customer Code],
    c.[Customer],
    s.[Salesman Code],
    sm.[Salesman],
    c.[Sector],
    c.[Class],
    c.[Region],
    c.[Branch];

PRINT '>> Step 4 complete: CustomerSummary refreshed';


-- ══════════════════════════════════════════════════
-- STEP 5: UPDATE STATISTICS
-- ══════════════════════════════════════════════════

UPDATE STATISTICS Sales WITH FULLSCAN;
UPDATE STATISTICS Customers WITH FULLSCAN;
UPDATE STATISTICS Products WITH FULLSCAN;
UPDATE STATISTICS CustomerSummary WITH FULLSCAN;

PRINT '>> Step 5 complete: Statistics updated';


-- ══════════════════════════════════════════════════
-- STEP 6: VERIFY
-- ══════════════════════════════════════════════════

SELECT 'Customers' AS [Table], COUNT(*) AS [Rows] FROM Customers
UNION ALL SELECT 'Products', COUNT(*) FROM Products
UNION ALL SELECT 'Sales', COUNT(*) FROM Sales
UNION ALL SELECT 'CustomerSummary', COUNT(*) FROM CustomerSummary
UNION ALL SELECT 'SalesmenData', COUNT(*) FROM SalesmenData
UNION ALL SELECT 'SUPdata', COUNT(*) FROM SUPdata
UNION ALL SELECT 'BSMdata', COUNT(*) FROM BSMdata
UNION ALL SELECT 'Users', COUNT(*) FROM Users;

-- Table sizes
SELECT
    t.name AS [Table],
    p.rows AS [Row Count],
    CAST(SUM(a.total_pages) * 8.0 / 1024 AS DECIMAL(10,2)) AS [Size MB]
FROM sys.tables t
JOIN sys.indexes i ON t.object_id = i.object_id
JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY t.name, p.rows
ORDER BY p.rows DESC;

-- Sample CustomerSummary
SELECT TOP 10 * FROM CustomerSummary ORDER BY [TotalCY] DESC;

PRINT '';
PRINT '══════════════════════════════════════════';
PRINT '  SETUP COMPLETE';
PRINT '══════════════════════════════════════════';
PRINT '';
PRINT 'DAILY DATA REFRESH WORKFLOW:';
PRINT '  1. Import new Sales CSV (DELETE + re-import, or append new rows)';
PRINT '  2. Run STEP 4 above to refresh CustomerSummary';
PRINT '  3. Call API: ?action=clearCache';
PRINT '';
PRINT 'OPTIONAL CLEANUP:';
PRINT '  DROP TABLE MasterData;  -- after confirming everything works';
