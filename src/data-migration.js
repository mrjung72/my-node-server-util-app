const mssql = require('mssql');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); 

// DB 설정
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


// --- 인자에서 파일경로 받기 ---
const tableFilePath = process.argv[2];
if (!fs.existsSync(tableFilePath)) {
  console.error(`❌ ${tableFilePath} 파일이 없습니다.`);
  process.exit(1);
}


async function migrateData() {
  try {
    
    const tableNames = fs.readFileSync(tableFilePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[a-zA-Z]/.test(line)); 
    
    if (tableNames.length === 0) {
      console.error('❌ tables.txt 파일에 테이블이 없습니다.');
      return;
    }
    
    const mssqlPool = await mssql.connect(mssqlConfig);
    const mariadbConn = await mysql.createConnection(mariadbConfig);
    const [curr_time] = await mariadbConn.query(`select DATE_FORMAT(now(), '%y%m%d%H%i%s') curr_time `)
    const work_id = `DM_${curr_time[0].curr_time}`
    console.log('work_id:', work_id)

    for (const tableName of tableNames) {

      console.log(`\n🚚 [${tableName}] 테이블 Truncate`);
      await mariadbConn.query(`TRUNCATE TABLE \`${tableName}\``);

      console.log(`🚚 [${tableName}] 데이터 가져오는 중...`);
      const mssqlResult = await mssqlPool.request().query(`SELECT TOP 10 * FROM [${tableName}] WITH (NOLOCK)`);
      const rows = mssqlResult.recordset;

      if (rows.length === 0) {
        console.log(`⚠️ [${tableName}] 테이블에 데이터 없음. 건너뜀.`);
        continue;
      }
      
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(',');
      const insertSQL = `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
     
      const insertValues = rows.map(row => columns.map(col => row[col]));
      const logSQL = `INSERT INTO data_migration_log (work_id, table_name, data_rows, result_desc) VALUES (?, ?, ?, ?)`;
      let resultMsg = ''
      
      // 트랜잭션 시작
      try {
        await mariadbConn.beginTransaction();

        for (const values of insertValues) {
          await mariadbConn.query(insertSQL, values);
        }
        await mariadbConn.commit();
        resultMsg = `✅ [${tableName}] ${rows.length}행 데이터이관 완료.`
        console.log(resultMsg);

      } catch (err) {
          await mariadbConn.rollback();
          resultMsg = `❌ [${tableName}] 트랜잭션 롤백됨: ${err.message}`
          console.error(resultMsg);
      } finally {
          await mariadbConn.query(logSQL, [work_id, tableName, rows.length, resultMsg]);
      }
    }

    await mssqlPool.close();
    await mariadbConn.end();
    console.log('\n🎉 모든 테이블의 데이터 마이그레이션 완료!');
  } catch (err) {
    console.error('❌ 데이터 마이그레이션 중 오류:', err);
  }
}

migrateData();
