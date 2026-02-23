-- ══════════════════════════════════════════════════════════════
-- FIX: Recreate tables with correct primary keys
-- 
-- Problem: SUPdata and BSMdata have duplicate codes per route/sector
-- Fix: Use auto-increment ID as PK, add indexes on code columns
-- ══════════════════════════════════════════════════════════════

-- ══ SECTION 1: Drop all tables ══
DROP TABLE IF EXISTS MasterData;
DROP TABLE IF EXISTS SalesmenData;
DROP TABLE IF EXISTS SUPdata;
DROP TABLE IF EXISTS BSMdata;
DROP TABLE IF EXISTS Users;
GO

-- ══ SECTION 2: Recreate with ID-based primary keys ══

CREATE TABLE Users (
    [User Code] NVARCHAR(20) PRIMARY KEY,
    [User Name] NVARCHAR(100) NOT NULL,
    [Role] NVARCHAR(50) NOT NULL
);

-- SalesmenData: Salesman can have multiple routes
CREATE TABLE SalesmenData (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
    [Salesman Code] NVARCHAR(20) NOT NULL,
    [Salesman] NVARCHAR(100),
    [Assigned SUP] NVARCHAR(20),
    [Route Code] NVARCHAR(20),
    [TGT] DECIMAL(18,2) DEFAULT 0,
    [ACT-CY] DECIMAL(18,2) DEFAULT 0,
    [%TGT] DECIMAL(8,2) DEFAULT 0
);

-- SUPdata: Supervisor can have multiple routes (duplicated Supervisor Code)
CREATE TABLE SUPdata (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
    [Supervisor Code] NVARCHAR(20) NOT NULL,
    [Supervisor] NVARCHAR(100),
    [Route Code] NVARCHAR(20),
    [AssignedBSM] NVARCHAR(20),
    [TGT] DECIMAL(18,2) DEFAULT 0,
    [ACT-CY] DECIMAL(18,2) DEFAULT 0,
    [%TGT] DECIMAL(8,2) DEFAULT 0
);

-- BSMdata: BSM can have multiple sectors/branches (duplicated BSM Code)
CREATE TABLE BSMdata (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
    [BSM Code] NVARCHAR(20) NOT NULL,
    [Branch Manager] NVARCHAR(100),
    [Sector] NVARCHAR(100),
    [Branch] NVARCHAR(100),
    [TGT] DECIMAL(18,2) DEFAULT 0,
    [ACT-CY] DECIMAL(18,2) DEFAULT 0,
    [%TGT] DECIMAL(8,2) DEFAULT 0
);

-- MasterData: 150K rows, ID auto-generated
CREATE TABLE MasterData (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
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
    [L3S] DECIMAL(18,2) DEFAULT 0,
    [L6S] DECIMAL(18,2) DEFAULT 0,
    [ACH CY (P)] DECIMAL(18,2) DEFAULT 0,
    [ACH LY (P)] DECIMAL(18,2) DEFAULT 0,
    [ACT-CY] DECIMAL(18,2) DEFAULT 0,
    [ACT-LY] DECIMAL(18,2) DEFAULT 0
);
GO

-- ══ SECTION 3: Indexes for fast queries ══
CREATE INDEX IX_SM_Code ON SalesmenData([Salesman Code]);
CREATE INDEX IX_SM_AssignedSUP ON SalesmenData([Assigned SUP]);
CREATE INDEX IX_SUP_Code ON SUPdata([Supervisor Code]);
CREATE INDEX IX_SUP_AssignedBSM ON SUPdata([AssignedBSM]);
CREATE INDEX IX_BSM_Code ON BSMdata([BSM Code]);
CREATE INDEX IX_MD_SalesmanCode ON MasterData([Salesman Code]);
CREATE INDEX IX_MD_SupervisorCode ON MasterData([Supervisor Code]);
CREATE INDEX IX_MD_CustomerCode ON MasterData([Customer Code]);
GO

-- ══ SECTION 4: Verify ══
SELECT 'Users' AS T, COUNT(*) AS Rows FROM Users
UNION ALL SELECT 'SalesmenData', COUNT(*) FROM SalesmenData
UNION ALL SELECT 'SUPdata', COUNT(*) FROM SUPdata
UNION ALL SELECT 'BSMdata', COUNT(*) FROM BSMdata
UNION ALL SELECT 'MasterData', COUNT(*) FROM MasterData;
