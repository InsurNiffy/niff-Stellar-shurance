import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "./index";
import {
  User,
  Policy,
  Claim,
  Vote,
  RawEvent,
  LedgerCursor,
  NotificationPreference,
  AuditLog,
} from "../entities";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: config.database.host || "localhost",
  port: config.database.port || 5432,
  username: config.database.username || "niff_user",
  password: config.database.password || "niff_password",
  database: config.database.name || "niff_stellar",
  synchronize: false,
  logging: process.env.NODE_ENV === "development",
  entities: [
    User,
    Policy,
    Claim,
    Vote,
    RawEvent,
    LedgerCursor,
    NotificationPreference,
    AuditLog,
  ],
  migrations: [__dirname + "/../database/migrations/*{.ts,.js}"],
  migrationsTableName: "typeorm_migrations",
  extra: {
    // Connection pool settings
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});

export default AppDataSource;