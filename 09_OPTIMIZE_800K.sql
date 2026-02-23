-- ══════════════════════════════════════════════════════════════
-- SQL OPTIMIZATION FOR 800K+ ROWS
-- Run in Azure Portal → Query Editor
-- ══════════════════════════════════════════════════════════════

-- ── 1. DROP old indexes and recreate optimized ones ──

-- MasterData: Main covering index for customer summary aggregation
IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_MD_SalesmanCode_Cover')
    DROP INDEX IX_MD_SalesmanCode_Cover ON MasterData;

-- This is THE most important index — covers the GROUP BY query
CREATE NONCLUSTERED INDEX IX_MD_SalesmanCode_Agg
ON MasterData(
    [Salesman Code],
    [Customer Code]
)
INCLUDE (
    [Customer], [Route Code], [Sector], [Class],
    [L3S], [L6S], [ACT-CY], [ACT-LY], [ACH CY (P)], [ACH LY (P)]
);

-- Index for Supervisor Code filter (BSM direct management)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_MD_SupervisorCode')
CREATE NONCLUSTERED INDEX IX_MD_SupervisorCode
ON MasterData([Supervisor Code])
INCLUDE ([Customer Code], [Salesman Code]);

-- Index for Customer Code lookups (customer detail page)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_MD_CustomerCode_Detail')
CREATE NONCLUSTERED INDEX IX_MD_CustomerCode_Detail
ON MasterData([Customer Code])
INCLUDE (
    [Salesman Code], [Supervisor Code], [Route Code],
    [Customer], [Sector], [Class], [Brand], [Product Group],
    [Sub Brand], [Product], [Date],
    [L3S], [L6S], [ACT-CY], [ACT-LY], [ACH CY (P)], [ACH LY (P)]
);

-- SalesmenData: fast lookup by Assigned SUP
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SM_AssignedSUP')
CREATE NONCLUSTERED INDEX IX_SM_AssignedSUP
ON SalesmenData([Assigned SUP])
INCLUDE ([Salesman Code], [Salesman], [Route Code], [TGT], [ACT-CY], [%TGT]);

-- SUPdata: fast lookup by AssignedBSM
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SUP_AssignedBSM')
CREATE NONCLUSTERED INDEX IX_SUP_AssignedBSM
ON SUPdata([AssignedBSM])
INCLUDE ([Supervisor Code], [Supervisor], [Route Code], [TGT], [ACT-CY], [%TGT]);

-- ── 2. Update statistics for query optimizer ──
UPDATE STATISTICS MasterData WITH FULLSCAN;
UPDATE STATISTICS SalesmenData WITH FULLSCAN;
UPDATE STATISTICS SUPdata WITH FULLSCAN;
UPDATE STATISTICS BSMdata WITH FULLSCAN;
UPDATE STATISTICS Users WITH FULLSCAN;

-- ── 3. Check table sizes ──
SELECT
    t.name AS TableName,
    p.rows AS [Row Count],
    CAST(SUM(a.total_pages) * 8.0 / 1024 AS DECIMAL(10,2)) AS SizeMB
FROM sys.tables t
JOIN sys.indexes i ON t.object_id = i.object_id
JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY t.name, p.rows
ORDER BY p.rows DESC;

-- ── 4. Verify indexes are being used ──
-- Run this AFTER the app makes a query, then check execution plan:
-- SET STATISTICS IO ON;
-- SELECT ... your query ...
-- SET STATISTICS IO OFF;

-- ── 5. Check index sizes ──
SELECT
    t.name AS TableName,
    i.name AS IndexName,
    i.type_desc,
    CAST(SUM(s.used_page_count) * 8.0 / 1024 AS DECIMAL(10,2)) AS SizeMB
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.dm_db_partition_stats s ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE t.name IN ('MasterData','SalesmenData','SUPdata','BSMdata','Users')
GROUP BY t.name, i.name, i.type_desc
ORDER BY SizeMB DESC;

PRINT '══ Optimization complete ══';
PRINT 'All indexes created. Statistics updated.';
PRINT 'Expected performance at 800K rows:';
PRINT '  - Customer summary: <1s (SQL aggregation with covering index)';
PRINT '  - Customer detail: <0.5s (index seek on Customer Code)';
PRINT '  - Login total: <2s (parallel queries)';
