// THIS FILE IS FOR DRIZZLE KIT TOOLS TO WORK

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: ['./schema/*.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    // bun drizzle-kit migrate tool uses this url for db connection
    url: 'postgresql://postgres:pass123@localhost:5431/mydb',
    // url: "postgres://postgres:pass123@localhost:5431/postgres",
  },
});
