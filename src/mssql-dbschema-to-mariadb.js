const mssql = require('mssql');
const mysql = require('mysql2/promise');

// 1. 설정 정보
const mssqlConfig = {
  user: 'sahara',
  password: '1111',
  server: 'localhost',
  database: 'mymssql',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const mariadbConfig = {
  host: 'localhost',
  user: 'sahara',
  password: '1111',
  database: 'mydb'
};

// 2. 데이터 타입 변환
function convertDataType(type, maxLength, precision, scale) {
  type = type.toLowerCase();
  switch (type) {
    case 'int': return 'INT';
    case 'bigint': return 'BIGINT';
    case 'bit': return 'BOOLEAN';
    case 'nvarchar':
    case 'varchar':
    case 'nchar':
    case 'char':
      return `VARCHAR(${maxLength || 255})`;
    case 'text':
    case 'ntext': return 'TEXT';
    case 'datetime':
    case 'smalldatetime': return 'DATETIME';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'decimal':
    case 'numeric': return `DECIMAL(${precision || 10},${scale || 0})`;
    case 'float': return 'FLOAT';
    case 'real': return 'FLOAT';
    case 'money': return 'DECIMAL(19,4)';
    default: return 'TEXT';
  }
}

// 3. 실행 함수
async function migrateSchema() {
  try {
    console.log('🔗 MSSQL 연결 중...');
    const mssqlPool = await mssql.connect(mssqlConfig);

    const tablesResult = await mssqlPool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);

    const tables = tablesResult.recordset.map(row => row.TABLE_NAME);
    console.log(`📦 테이블 수: ${tables.length}`);

    const mariadbConn = await mysql.createConnection(mariadbConfig);

    for (const tableName of tables) {
      console.log(`\n🔄 [${tableName}] 테이블 처리 중...`);

      // 컬럼 메타 + 설명 가져오기
      const columnsResult = await mssqlPool.request().query(`
        SELECT 
          c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, 
          c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE,
          ep.value AS COLUMN_COMMENT
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN sys.columns sc 
          ON sc.object_id = OBJECT_ID('${tableName}') AND sc.name = c.COLUMN_NAME
        LEFT JOIN sys.extended_properties ep 
          ON ep.major_id = sc.object_id AND ep.minor_id = sc.column_id AND ep.name = 'MS_Description'
        WHERE c.TABLE_NAME = '${tableName}'
      `);

      const columns = columnsResult.recordset;

      const columnDefs = columns.map(col => {
        const dataType = convertDataType(
          col.DATA_TYPE,
          col.CHARACTER_MAXIMUM_LENGTH,
          col.NUMERIC_PRECISION,
          col.NUMERIC_SCALE
        );
        const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        const comment = col.COLUMN_COMMENT ? `COMMENT '${col.COLUMN_COMMENT.replace(/'/g, "\\'")}'` : '';
        return `\`${col.COLUMN_NAME}\` ${dataType} ${nullable} ${comment}`;
      });

      const createTableSQL = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
${columnDefs.join(',\n')}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

      console.log(`🛠️ 생성 SQL:\n${createTableSQL}`);
      await mariadbConn.query(createTableSQL);
      console.log(`✅ [${tableName}] 생성 완료.`);
    }

    await mssqlPool.close();
    await mariadbConn.end();
    console.log('\n🎉 모든 테이블 마이그레이션 완료!');
  } catch (err) {
    console.error('❌ 오류 발생:', err);
  }
}

migrateSchema();
