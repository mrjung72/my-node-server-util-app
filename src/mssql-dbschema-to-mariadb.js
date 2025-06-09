const mssql = require('mssql');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // 환경변수 로드

// 설정
const mssqlConfig = {
  user: process.env.REMOTEDB_USER,
  password: process.env.REMOTEDB_PASSWORD,
  server: process.env.REMOTEDB_HOST,
  port: Number(process.env.REMOTEDB_PORT)||1433,
  database: process.env.REMOTEDB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

const mariadbConfig = {
  host: process.env.LOCALDB_HOST,
  port: Number(process.env.LOCALDB_PORT)||3306,
  database: process.env.LOCALDB_NAME,
  user: process.env.LOCALDB_USER,
  password: process.env.LOCALDB_PASSWORD
};

// 타입 변환
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
    case 'float':
    case 'real': return 'FLOAT';
    case 'money': return 'DECIMAL(19,4)';
    default: return 'TEXT';
  }
}

// --- 인자에서 파일경로 받기 ---
const tableFilePath = process.argv[2];
if (!fs.existsSync(tableFilePath)) {
  console.error(`❌ ${tableFilePath} 파일이 없습니다.`);
  process.exit(1);
}

  // 메인 함수
async function migrateSchemaFromFile() {
  try {

    const tableNames = fs.readFileSync(tableFilePath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[a-zA-Z]/.test(line)); 

    if (tableNames.length === 0) {
      console.error('❌ tables.txt 파일에 테이블이 없습니다.');
      return;
    }

    console.log(`📄 테이블 목록 (${tableNames.length}개):`, tableNames);

    const mssqlPool = await mssql.connect(mssqlConfig);
    const mariadbConn = await mysql.createConnection(mariadbConfig);

    for (const tableName of tableNames) {
      console.log(`\n🔄 [${tableName}] 테이블 처리 중...`);

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

      if (columns.length === 0) {
        console.warn(`⚠️ 테이블 [${tableName}]에 컬럼이 없습니다. 건너뜁니다.`);
        continue;
      }

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

migrateSchemaFromFile();
