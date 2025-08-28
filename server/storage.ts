import {
  users,
  companions,
  calls,
  reviews,
  gifts,
  giftTransactions,
  transactions,
  withdrawals,
  referralCodes,
  referralUsage,
  affiliateProgram,
  type User,
  type UpsertUser,
  type Companion,
  type InsertCompanion,
  type Call,
  type InsertCall,
  type Review,
  type InsertReview,
  type Gift,
  type GiftTransaction,
  type InsertGiftTransaction,
  type Transaction,
  type InsertTransaction,
  type Withdrawal,
  type InsertWithdrawal,
  type ReferralCode,
  type InsertReferralCode,
  type ReferralUsage,
  type AffiliateProgram,
  type InsertAffiliateProgram,
  type SubscriptionPlan,
  type UserSubscription,
  type InsertUserSubscription,
  subscriptionPlans,
  userSubscriptions,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, avg, count } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Companion operations
  createCompanion(companion: InsertCompanion): Promise<Companion>;
  getCompanionByUserId(userId: string): Promise<Companion | undefined>;
  getCompanion(id: string): Promise<Companion | undefined>;
  updateCompanion(id: string, updates: Partial<InsertCompanion>): Promise<Companion>;
  getAvailableCompanions(filters?: {
    languages?: string[];
    interests?: string[];
    minRating?: number;
    maxRate?: number;
    sortBy?: string;
    location?: string;
  }): Promise<Companion[]>;
  getPersonalizedRecommendations(userId: string): Promise<Companion[]>;
  getTrendingCompanions(): Promise<Companion[]>;
  
  // Call operations
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<InsertCall>): Promise<Call>;
  getCall(id: string): Promise<Call | undefined>;
  getUserCalls(userId: string): Promise<Call[]>;
  getCompanionCalls(companionId: string): Promise<Call[]>;
  
  // Review operations
  createReview(review: InsertReview): Promise<Review>;
  getCompanionReviews(companionId: string): Promise<Review[]>;
  
  // Gift operations
  getGifts(): Promise<Gift[]>;
  createGiftTransaction(transaction: InsertGiftTransaction): Promise<GiftTransaction>;
  
  // Transaction operations
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getUserTransactions(userId: string): Promise<Transaction[]>;
  updateUserCoinBalance(userId: string, coins: number): Promise<User>;
  
  // Withdrawal operations
  createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal>;
  getCompanionWithdrawals(companionId: string): Promise<Withdrawal[]>;
  updateWithdrawal(id: string, status: string, processedAt?: Date): Promise<Withdrawal>;
  
  // Analytics
  getCompanionEarnings(companionId: string, period: 'today' | 'week' | 'month'): Promise<number>;
  updateCompanionRating(companionId: string): Promise<void>;
  
  // Referral operations
  createReferralCode(referralCode: InsertReferralCode): Promise<ReferralCode>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | undefined>;
  getUserReferralCodes(userId: string): Promise<ReferralCode[]>;
  updateReferralCodeUsage(codeId: string, currentUses: number): Promise<ReferralCode>;
  createReferralUsage(usage: Omit<ReferralUsage, 'id' | 'createdAt'>): Promise<ReferralUsage>;
  getReferralUsageByUserId(userId: string): Promise<ReferralUsage | undefined>;
  
  // Affiliate operations
  createAffiliateProfile(affiliate: InsertAffiliateProgram): Promise<AffiliateProgram>;
  getAffiliateByUserId(userId: string): Promise<AffiliateProgram | undefined>;
  getAffiliateEarnings(affiliateId: string): Promise<any>;
  
  // Subscription operations
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getUserSubscription(userId: string): Promise<UserSubscription | undefined>;
  createUserSubscription(subscription: InsertUserSubscription): Promise<UserSubscription>;
  cancelUserSubscription(userId: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  // User operations (required for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Companion operations
  async createCompanion(companion: InsertCompanion): Promise<Companion> {
    const [newCompanion] = await db.insert(companions).values(companion).returning();
    return newCompanion;
  }

  async getCompanionByUserId(userId: string): Promise<Companion | undefined> {
    const [companion] = await db
      .select()
      .from(companions)
      .where(eq(companions.userId, userId));
    return companion;
  }

  async getCompanion(id: string): Promise<Companion | undefined> {
    const [companion] = await db
      .select()
      .from(companions)
      .where(eq(companions.id, id));
    return companion;
  }

  async updateCompanion(id: string, updates: Partial<InsertCompanion>): Promise<Companion> {
    const [companion] = await db
      .update(companions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companions.id, id))
      .returning();
    return companion;
  }

  async getAvailableCompanions(filters?: {
    languages?: string[];
    interests?: string[];
    minRating?: number;
    maxRate?: number;
    sortBy?: string;
    location?: string;
  }): Promise<Companion[]> {
    let query = db
      .select()
      .from(companions)
      .where(and(
        eq(companions.availabilityStatus, 'online'),
        eq(companions.verificationStatus, 'verified')
      ));

    // Apply filters
    let conditions = [eq(companions.availabilityStatus, 'online')];
    
    if (filters?.minRating) {
      conditions.push(sql`${companions.averageRating}::float >= ${filters.minRating}`);
    }
    
    if (filters?.maxRate) {
      conditions.push(sql`${companions.ratePerMinute}::float <= ${filters.maxRate}`);
    }
    
    if (filters?.location) {
      conditions.push(sql`${companions.city} ILIKE ${`%${filters.location}%`}`);
    }
    
    // Language and interest filtering would require more complex array operations
    // For now, we'll do a simple implementation
    
    const sortOrder = filters?.sortBy === 'price' ? companions.ratePerMinute : 
                     filters?.sortBy === 'newest' ? desc(companions.createdAt) :
                     desc(companions.averageRating); // default to rating
    
    return await db
      .select()
      .from(companions)
      .where(and(...conditions))
      .orderBy(sortOrder)
      .limit(50);
  }

  async getPersonalizedRecommendations(userId: string): Promise<Companion[]> {
    // AI-powered recommendations based on user's call history, interests, and preferences
    // This is a simplified algorithm - in production, this would use ML models
    
    // Get user's call history to understand preferences
    const userCalls = await db
      .select({ companionId: calls.companionId, rating: reviews.rating })
      .from(calls)
      .leftJoin(reviews, eq(calls.id, reviews.callId))
      .where(eq(calls.clientId, userId))
      .limit(10);
    
    // Get companions the user interacted with to find similar ones
    const preferredCompanionIds = userCalls.map(call => call.companionId);
    
    // Find companions with similar profiles (simplified similarity matching)
    let recommendations = await db
      .select()
      .from(companions)
      .where(and(
        eq(companions.availabilityStatus, 'online'),
        eq(companions.verificationStatus, 'verified'),
        sql`${companions.id} NOT IN (${preferredCompanionIds.length > 0 ? preferredCompanionIds.join(',') : 'null'})`
      ))
      .orderBy(
        // Boost companions with higher ratings and similar interests
        desc(companions.averageRating),
        desc(companions.totalReviews)
      )
      .limit(20);
    
    // If user has no history, show trending companions
    if (recommendations.length === 0) {
      recommendations = await this.getTrendingCompanions();
    }
    
    return recommendations;
  }

  async getTrendingCompanions(): Promise<Companion[]> {
    // Get companions with high engagement in the last week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    return await db
      .select({
        ...companions,
        recentCallCount: count(calls.id)
      })
      .from(companions)
      .leftJoin(calls, and(
        eq(calls.companionId, companions.id),
        sql`${calls.createdAt} >= ${oneWeekAgo}`
      ))
      .where(and(
        eq(companions.availabilityStatus, 'online'),
        eq(companions.verificationStatus, 'verified')
      ))
      .groupBy(companions.id)
      .orderBy(
        desc(count(calls.id)), // Most calls this week
        desc(companions.averageRating), // Then by rating
        desc(companions.totalReviews) // Then by total reviews
      )
      .limit(30);
  }

  // Call operations
  async createCall(call: InsertCall): Promise<Call> {
    const [newCall] = await db.insert(calls).values(call).returning();
    return newCall;
  }

  async updateCall(id: string, updates: Partial<InsertCall>): Promise<Call> {
    const [call] = await db
      .update(calls)
      .set(updates)
      .where(eq(calls.id, id))
      .returning();
    return call;
  }

  async getCall(id: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }

  async getUserCalls(userId: string): Promise<Call[]> {
    return await db
      .select()
      .from(calls)
      .where(eq(calls.clientId, userId))
      .orderBy(desc(calls.createdAt));
  }

  async getCompanionCalls(companionId: string): Promise<Call[]> {
    return await db
      .select()
      .from(calls)
      .where(eq(calls.companionId, companionId))
      .orderBy(desc(calls.createdAt));
  }

  // Review operations
  async createReview(review: InsertReview): Promise<Review> {
    const [newReview] = await db.insert(reviews).values(review).returning();
    
    // Update companion rating after new review
    await this.updateCompanionRating(review.companionId);
    
    return newReview;
  }

  async getCompanionReviews(companionId: string): Promise<Review[]> {
    return await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.companionId, companionId), eq(reviews.isPublic, true)))
      .orderBy(desc(reviews.createdAt));
  }

  // Gift operations
  async getGifts(): Promise<Gift[]> {
    return await db
      .select()
      .from(gifts)
      .where(eq(gifts.isActive, true))
      .orderBy(gifts.coinCost);
  }

  async createGiftTransaction(transaction: InsertGiftTransaction): Promise<GiftTransaction> {
    const [newTransaction] = await db
      .insert(giftTransactions)
      .values(transaction)
      .returning();
    return newTransaction;
  }

  // Transaction operations
  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db
      .insert(transactions)
      .values(transaction)
      .returning();
    return newTransaction;
  }

  async getUserTransactions(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));
  }

  async updateUserCoinBalance(userId: string, coins: number): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        coinBalance: sql`${users.coinBalance} + ${coins}`,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Withdrawal operations
  async createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal> {
    const [newWithdrawal] = await db
      .insert(withdrawals)
      .values(withdrawal)
      .returning();
    return newWithdrawal;
  }

  async getCompanionWithdrawals(companionId: string): Promise<Withdrawal[]> {
    return await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.companionId, companionId))
      .orderBy(desc(withdrawals.createdAt));
  }

  async updateWithdrawal(id: string, status: string, processedAt?: Date): Promise<Withdrawal> {
    const [withdrawal] = await db
      .update(withdrawals)
      .set({ status, processedAt })
      .where(eq(withdrawals.id, id))
      .returning();
    return withdrawal;
  }

  // Analytics
  async getCompanionEarnings(companionId: string, period: 'today' | 'week' | 'month'): Promise<number> {
    let dateFilter;
    const now = new Date();
    
    switch (period) {
      case 'today':
        dateFilter = sql`${calls.createdAt} >= ${new Date(now.getFullYear(), now.getMonth(), now.getDate())}`;
        break;
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = sql`${calls.createdAt} >= ${weekAgo}`;
        break;
      case 'month':
        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        dateFilter = sql`${calls.createdAt} >= ${monthAgo}`;
        break;
    }

    const [result] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${calls.totalCost}), 0)` 
      })
      .from(calls)
      .where(
        and(
          eq(calls.companionId, companionId),
          eq(calls.status, 'completed'),
          dateFilter
        )
      );

    return Number(result.total || 0);
  }

  async updateCompanionRating(companionId: string): Promise<void> {
    const [ratingData] = await db
      .select({
        avgRating: avg(reviews.rating),
        totalReviews: count(reviews.id)
      })
      .from(reviews)
      .where(eq(reviews.companionId, companionId));

    await db
      .update(companions)
      .set({
        averageRating: ratingData.avgRating?.toString() || '0',
        totalReviews: Number(ratingData.totalReviews || 0),
        updatedAt: new Date()
      })
      .where(eq(companions.id, companionId));
  }

  // Referral operations
  async createReferralCode(referralCode: InsertReferralCode): Promise<ReferralCode> {
    const [code] = await db.insert(referralCodes).values(referralCode).returning();
    return code;
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | undefined> {
    const [referralCode] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code));
    return referralCode;
  }

  async getUserReferralCodes(userId: string): Promise<ReferralCode[]> {
    return await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.referrerId, userId))
      .orderBy(desc(referralCodes.createdAt));
  }

  async updateReferralCodeUsage(codeId: string, currentUses: number): Promise<ReferralCode> {
    const [code] = await db
      .update(referralCodes)
      .set({ currentUses })
      .where(eq(referralCodes.id, codeId))
      .returning();
    return code;
  }

  async createReferralUsage(usage: Omit<ReferralUsage, 'id' | 'createdAt'>): Promise<ReferralUsage> {
    const [referralUsageRecord] = await db.insert(referralUsage).values(usage).returning();
    return referralUsageRecord;
  }

  async getReferralUsageByUserId(userId: string): Promise<ReferralUsage | undefined> {
    const [usage] = await db
      .select()
      .from(referralUsage)
      .where(eq(referralUsage.referredUserId, userId));
    return usage;
  }

  // Affiliate operations
  async createAffiliateProfile(affiliate: InsertAffiliateProgram): Promise<AffiliateProgram> {
    const [profile] = await db.insert(affiliateProgram).values(affiliate).returning();
    return profile;
  }

  async getAffiliateByUserId(userId: string): Promise<AffiliateProgram | undefined> {
    const [affiliate] = await db
      .select()
      .from(affiliateProgram)
      .where(eq(affiliateProgram.userId, userId));
    return affiliate;
  }

  async getAffiliateEarnings(affiliateId: string): Promise<any> {
    // This would typically involve complex queries to calculate affiliate earnings
    // For now, return the basic affiliate data
    const affiliate = await db
      .select()
      .from(affiliateProgram)
      .where(eq(affiliateProgram.id, affiliateId));
    
    return affiliate[0] || {};
  }

  // Subscription operations
  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.priceMonthly);
  }

  async getUserSubscription(userId: string): Promise<UserSubscription | undefined> {
    const [subscription] = await db
      .select({
        ...userSubscriptions,
        plan: subscriptionPlans
      })
      .from(userSubscriptions)
      .leftJoin(subscriptionPlans, eq(userSubscriptions.planId, subscriptionPlans.id))
      .where(and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 'active')
      ));
    return subscription as any;
  }

  async createUserSubscription(subscription: InsertUserSubscription): Promise<UserSubscription> {
    // First cancel any existing active subscription
    await db
      .update(userSubscriptions)
      .set({ 
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(userSubscriptions.userId, subscription.userId),
        eq(userSubscriptions.status, 'active')
      ));

    // Create new subscription
    const [newSubscription] = await db
      .insert(userSubscriptions)
      .values(subscription)
      .returning();
    return newSubscription;
  }

  async cancelUserSubscription(userId: string): Promise<any> {
    const [cancelled] = await db
      .update(userSubscriptions)
      .set({ 
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .returning();
    return cancelled;
  }
}

export const storage = new DatabaseStorage();
