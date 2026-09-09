import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { listSkills } from "../src/services/skillLibraryService.js";
dotenv.config();
const skills = await listSkills();
const sample = skills.find(s => s.note) || skills[0];
console.log("skills", skills.length, "sample note field:", sample?.id, JSON.stringify(sample?.note));
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const [cols] = await conn.query("SHOW COLUMNS FROM calculator_skills LIKE 'note'");
console.log("note column:", cols);
await conn.end();
