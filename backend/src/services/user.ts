import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { StaffUser, StaffRole, LoginRequest, LoginResponse } from '../types';
import config from '../config';

/**
 * In-memory user store (replace with database in production)
 * WARNING: This is for demonstration - use a proper database in production
 */
const users: Map<string, StaffUser> = new Map();

/**
 * UserService - handles user authentication and management
 */
export class UserService {
  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcrypt.saltRounds);
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Create a new staff user
   */
  async createUser(email: string, password: string, role: StaffRole): Promise<StaffUser> {
    const existingUser = Array.from(users.values()).find(u => u.email === email);
    if (existingUser) {
      throw new Error('User already exists');
    }

    const passwordHash = await this.hashPassword(password);
    const user: StaffUser = {
      id: uuidv4(),
      email: email.toLowerCase(),
      passwordHash,
      role,
      createdAt: new Date(),
      isActive: true,
    };

    users.set(user.id, user);
    return user;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<StaffUser | null> {
    const user = Array.from(users.values()).find(u => u.email === email.toLowerCase());
    return user || null;
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<StaffUser | null> {
    return users.get(id) || null;
  }

  /**
   * Authenticate user with email and password
   */
  async authenticate(email: string, password: string): Promise<StaffUser | null> {
    const user = await this.findByEmail(email);
    
    if (!user) {
      return null;
    }

    if (!user.isActive) {
      return null;
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    // Update last login
    user.lastLoginAt = new Date();
    users.set(user.id, user);

    return user;
  }

  /**
   * Initialize default admin user (for development)
   */
  async initializeDefaultUser(): Promise<void> {
    const adminExists = Array.from(users.values()).some(u => u.role === 'admin');
    
    if (!adminExists) {
      const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@niffyinsure.com';
      const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;
      const supportEmail = process.env.DEFAULT_SUPPORT_EMAIL || 'support@niffyinsure.com';
      const supportPassword = process.env.DEFAULT_SUPPORT_PASSWORD;

      if (!adminPassword || !supportPassword) {
        throw new Error('DEFAULT_ADMIN_PASSWORD and DEFAULT_SUPPORT_PASSWORD env vars are required');
      }

      await this.createUser(adminEmail, adminPassword, 'admin');
      await this.createUser(supportEmail, supportPassword, 'support_readonly');
      console.log('Default staff users created');
    }
  }

  /**
   * Get all users (for admin management - exclude passwords)
   */
  async getAllUsers(): Promise<Omit<StaffUser, 'passwordHash'>[]> {
    return Array.from(users.values()).map(({ passwordHash, ...user }) => user);
  }

  /**
   * Deactivate a user
   */
  async deactivateUser(id: string): Promise<boolean> {
    const user = users.get(id);
    if (!user) {
      return false;
    }
    user.isActive = false;
    users.set(id, user);
    return true;
  }
}

export const userService = new UserService();
export default userService;