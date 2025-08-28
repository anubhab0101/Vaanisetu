import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  decimal,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Enums
export const userTypeEnum = pgEnum('user_type', ['client', 'companion', 'admin']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected']);
export const availabilityStatusEnum = pgEnum('availability_status', ['online', 'offline', 'busy']);
export const callStatusEnum = pgEnum('call_status', ['pending', 'active', 'completed', 'cancelled']);
export const transactionTypeEnum = pgEnum('transaction_type', ['coin_purchase', 'call_payment', 'gift_sent', 'earnings', 'withdrawal', 'referral_bonus', 'affiliate_earnings']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'inactive', 'cancelled', 'past_due']);
export const referralStatusEnum = pgEnum('referral_status', ['pending', 'completed', 'cancelled']);

// Users table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  userType: userTypeEnum("user_type").notNull().default('client'),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  coinBalance: integer("coin_balance").notNull().default(0),
  phoneNumber: varchar("phone_number"),
  isPhoneVerified: boolean("is_phone_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Companion profiles
export const companions = pgTable("companions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar("display_name").notNull(),
  bio: text("bio"),
  age: integer("age"),
  city: varchar("city"),
  languages: text("languages").array(),
  interests: text("interests").array(),
  ratePerMinute: decimal("rate_per_minute", { precision: 10, scale: 2 }).notNull(),
  availabilityStatus: availabilityStatusEnum("availability_status").notNull().default('offline'),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default('pending'),
  governmentIdUrl: varchar("government_id_url"),
  profilePhotos: text("profile_photos").array(),
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }).default('0'),
  totalReviews: integer("total_reviews").notNull().default(0),
  totalMinutesCompleted: integer("total_minutes_completed").notNull().default(0),
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).notNull().default('0'),
  withdrawableBalance: decimal("withdrawable_balance", { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Calls table
export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => users.id),
  companionId: varchar("companion_id").notNull().references(() => companions.id),
  status: callStatusEnum("status").notNull().default('pending'),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  durationMinutes: integer("duration_minutes"),
  ratePerMinute: decimal("rate_per_minute", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }),
  coinsDeducted: integer("coins_deducted"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Reviews table
export const reviews = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => calls.id),
  clientId: varchar("client_id").notNull().references(() => users.id),
  companionId: varchar("companion_id").notNull().references(() => companions.id),
  rating: integer("rating").notNull(), // 1-5 stars
  reviewText: text("review_text"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Virtual gifts
export const gifts = pgTable("gifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  emoji: varchar("emoji").notNull(),
  coinCost: integer("coin_cost").notNull(),
  category: varchar("category").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

// Gift transactions
export const giftTransactions = pgTable("gift_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  receiverId: varchar("receiver_id").notNull().references(() => companions.id),
  giftId: varchar("gift_id").notNull().references(() => gifts.id),
  callId: varchar("call_id").references(() => calls.id),
  coinCost: integer("coin_cost").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transactions (wallet, earnings, etc.)
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: transactionTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  coinAmount: integer("coin_amount"),
  description: text("description"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  relatedCallId: varchar("related_call_id").references(() => calls.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Withdrawals
export const withdrawals = pgTable("withdrawals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companionId: varchar("companion_id").notNull().references(() => companions.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  bankAccountNumber: varchar("bank_account_number"),
  ifscCode: varchar("ifsc_code"),
  upiId: varchar("upi_id"),
  status: varchar("status").notNull().default('pending'), // pending, processing, completed, failed
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Subscription plans
export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  priceMonthly: decimal("price_monthly", { precision: 10, scale: 2 }).notNull(),
  features: text("features").array(),
  maxCallsPerMonth: integer("max_calls_per_month"),
  bonusCoinsPerMonth: integer("bonus_coins_per_month").default(0),
  isActive: boolean("is_active").notNull().default(true),
  stripePriceId: varchar("stripe_price_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// User subscriptions
export const userSubscriptions = pgTable("user_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: varchar("plan_id").notNull().references(() => subscriptionPlans.id),
  status: subscriptionStatusEnum("status").notNull().default('active'),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Referral codes
export const referralCodes = pgTable("referral_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code").unique().notNull(),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  bonusCoins: integer("bonus_coins").notNull().default(100),
  referrerBonus: integer("referrer_bonus").notNull().default(50),
  maxUses: integer("max_uses").default(100),
  currentUses: integer("current_uses").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Referral usage tracking
export const referralUsage = pgTable("referral_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  codeId: varchar("code_id").notNull().references(() => referralCodes.id),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  referredUserId: varchar("referred_user_id").notNull().references(() => users.id),
  status: referralStatusEnum("status").notNull().default('completed'),
  bonusCoinsAwarded: integer("bonus_coins_awarded").notNull(),
  referrerBonusAwarded: integer("referrer_bonus_awarded").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Affiliate program
export const affiliateProgram = pgTable("affiliate_program", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  affiliateCode: varchar("affiliate_code").unique().notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default('5.00'), // 5% default
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).notNull().default('0'),
  totalReferrals: integer("total_referrals").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  paypalEmail: varchar("paypal_email"),
  bankDetails: text("bank_details"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User preferences for AI matching
export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  preferredLanguages: text("preferred_languages").array().default([]),
  preferredInterests: text("preferred_interests").array().default([]),
  ageRangeMin: integer("age_range_min").default(18),
  ageRangeMax: integer("age_range_max").default(50),
  maxRatePerMinute: decimal("max_rate_per_minute", { precision: 10, scale: 2 }).default("100.00"),
  preferredGender: varchar("preferred_gender", { length: 10 }).default("any"), // any, male, female
  preferredLocation: varchar("preferred_location", { length: 100 }),
  notificationSettings: jsonb("notification_settings").default({
    newMatches: true,
    priceDrops: true,
    companionOnline: false,
    weeklyRecommendations: true
  }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Push notification tokens
export const pushTokens = pgTable("push_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text("token").notNull(),
  platform: varchar("platform").notNull(), // 'web', 'android', 'ios'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Notifications
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  type: varchar("type").notNull(), // 'call_request', 'gift_received', 'earnings', 'system'
  isRead: boolean("is_read").notNull().default(false),
  relatedCallId: varchar("related_call_id").references(() => calls.id),
  relatedUserId: varchar("related_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  companionProfile: one(companions, {
    fields: [users.id],
    references: [companions.userId],
  }),
  clientCalls: many(calls, { relationName: "clientCalls" }),
  sentGifts: many(giftTransactions, { relationName: "sentGifts" }),
  transactions: many(transactions),
  reviews: many(reviews),
  subscription: one(userSubscriptions),
  referralCodes: many(referralCodes),
  referralUsageAsReferrer: many(referralUsage, { relationName: "referrer" }),
  referralUsageAsReferred: many(referralUsage, { relationName: "referred" }),
  affiliateProfile: one(affiliateProgram),
  preferences: one(userPreferences),
  pushTokens: many(pushTokens),
  notifications: many(notifications),
}));

export const companionsRelations = relations(companions, ({ one, many }) => ({
  user: one(users, {
    fields: [companions.userId],
    references: [users.id],
  }),
  calls: many(calls),
  receivedGifts: many(giftTransactions),
  reviews: many(reviews),
  withdrawals: many(withdrawals),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  client: one(users, {
    fields: [calls.clientId],
    references: [users.id],
    relationName: "clientCalls",
  }),
  companion: one(companions, {
    fields: [calls.companionId],
    references: [companions.id],
  }),
  review: one(reviews),
  gifts: many(giftTransactions),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  call: one(calls, {
    fields: [reviews.callId],
    references: [calls.id],
  }),
  client: one(users, {
    fields: [reviews.clientId],
    references: [users.id],
  }),
  companion: one(companions, {
    fields: [reviews.companionId],
    references: [companions.id],
  }),
}));

export const giftsRelations = relations(gifts, ({ many }) => ({
  transactions: many(giftTransactions),
}));

export const giftTransactionsRelations = relations(giftTransactions, ({ one }) => ({
  sender: one(users, {
    fields: [giftTransactions.senderId],
    references: [users.id],
    relationName: "sentGifts",
  }),
  receiver: one(companions, {
    fields: [giftTransactions.receiverId],
    references: [companions.id],
  }),
  gift: one(gifts, {
    fields: [giftTransactions.giftId],
    references: [gifts.id],
  }),
  call: one(calls, {
    fields: [giftTransactions.callId],
    references: [calls.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  relatedCall: one(calls, {
    fields: [transactions.relatedCallId],
    references: [calls.id],
  }),
}));

export const withdrawalsRelations = relations(withdrawals, ({ one }) => ({
  companion: one(companions, {
    fields: [withdrawals.companionId],
    references: [companions.id],
  }),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
  subscriptions: many(userSubscriptions),
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [userSubscriptions.planId],
    references: [subscriptionPlans.id],
  }),
}));

export const referralCodesRelations = relations(referralCodes, ({ one, many }) => ({
  referrer: one(users, {
    fields: [referralCodes.referrerId],
    references: [users.id],
  }),
  usages: many(referralUsage),
}));

export const referralUsageRelations = relations(referralUsage, ({ one }) => ({
  code: one(referralCodes, {
    fields: [referralUsage.codeId],
    references: [referralCodes.id],
  }),
  referrer: one(users, {
    fields: [referralUsage.referrerId],
    references: [users.id],
    relationName: "referrer",
  }),
  referredUser: one(users, {
    fields: [referralUsage.referredUserId],
    references: [users.id],
    relationName: "referred",
  }),
}));

export const affiliateProgramRelations = relations(affiliateProgram, ({ one }) => ({
  user: one(users, {
    fields: [affiliateProgram.userId],
    references: [users.id],
  }),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  relatedCall: one(calls, {
    fields: [notifications.relatedCallId],
    references: [calls.id],
  }),
  relatedUser: one(users, {
    fields: [notifications.relatedUserId],
    references: [users.id],
    relationName: "notificationRelatedUser",
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  userType: true,
  phoneNumber: true,
});

export const insertCompanionSchema = createInsertSchema(companions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  createdAt: true,
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
});

export const insertGiftTransactionSchema = createInsertSchema(giftTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export const insertWithdrawalSchema = createInsertSchema(withdrawals).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({
  id: true,
  createdAt: true,
});

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({
  id: true,
  currentUses: true,
  createdAt: true,
});

export const insertAffiliateProgramSchema = createInsertSchema(affiliateProgram).omit({
  id: true,
  totalEarnings: true,
  totalReferrals: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  isRead: true,
  createdAt: true,
});

// Types
export type UpsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertCompanion = z.infer<typeof insertCompanionSchema>;
export type Companion = typeof companions.$inferSelect;
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;
export type Gift = typeof gifts.$inferSelect;
export type InsertGiftTransaction = z.infer<typeof insertGiftTransactionSchema>;
export type GiftTransaction = typeof giftTransactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralUsage = typeof referralUsage.$inferSelect;
export type AffiliateProgram = typeof affiliateProgram.$inferSelect;
export type InsertAffiliateProgram = z.infer<typeof insertAffiliateProgramSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type PushToken = typeof pushTokens.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
