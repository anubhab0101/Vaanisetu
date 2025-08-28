import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Stripe from "stripe";
import Razorpay from "razorpay";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertCompanionSchema, insertCallSchema, insertReviewSchema } from "@shared/schema";

// Initialize Stripe only if keys are available
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-07-30.basil",
  });
}

// Initialize Razorpay for Indian payments (UPI, cards, wallets)
let razorpay: Razorpay | null = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// WebRTC signaling users
const signalingUsers = new Map<string, WebSocket>();

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Also fetch companion profile if user is a companion
      let companionProfile = null;
      if (user.userType === 'companion') {
        companionProfile = await storage.getCompanionByUserId(user.id);
      }

      res.json({ ...user, companionProfile });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // User type setup
  app.post('/api/setup-user-type', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { userType } = req.body;

      if (!['client', 'companion'].includes(userType)) {
        return res.status(400).json({ message: "Invalid user type" });
      }

      await storage.upsertUser({
        email: req.user.claims.email,
        firstName: req.user.claims.first_name,
        lastName: req.user.claims.last_name,
        userType,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error setting up user type:", error);
      res.status(500).json({ message: "Failed to setup user type" });
    }
  });

  // Companion routes
  app.post('/api/companions', isAuthenticated, upload.array('photos', 5), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      if (!user || user.userType !== 'companion') {
        return res.status(403).json({ message: "Access denied. Must be a companion." });
      }

      const companionData = insertCompanionSchema.parse({
        ...req.body,
        userId,
        languages: JSON.parse(req.body.languages || '[]'),
        interests: JSON.parse(req.body.interests || '[]'),
        profilePhotos: req.files?.map((file: any) => file.filename) || [],
      });

      const companion = await storage.createCompanion(companionData);
      res.json(companion);
    } catch (error) {
      console.error("Error creating companion profile:", error);
      res.status(500).json({ message: "Failed to create companion profile" });
    }
  });

  app.put('/api/companions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const companionId = req.params.id;
      
      const companion = await storage.getCompanion(companionId);
      if (!companion || companion.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updates = {
        ...req.body,
        languages: req.body.languages ? JSON.parse(req.body.languages) : undefined,
        interests: req.body.interests ? JSON.parse(req.body.interests) : undefined,
      };

      const updatedCompanion = await storage.updateCompanion(companionId, updates);
      res.json(updatedCompanion);
    } catch (error) {
      console.error("Error updating companion:", error);
      res.status(500).json({ message: "Failed to update companion profile" });
    }
  });

  app.get('/api/companions', async (req, res) => {
    try {
      const { languages, interests, minRating, maxRate, sortBy, location } = req.query;
      
      const filters = {
        languages: languages ? (languages as string).split(',') : undefined,
        interests: interests ? (interests as string).split(',') : undefined,
        minRating: minRating ? parseFloat(minRating as string) : undefined,
        maxRate: maxRate ? parseFloat(maxRate as string) : undefined,
        sortBy: sortBy as string || 'rating',
        location: location as string,
      };

      const companions = await storage.getAvailableCompanions(filters);
      res.json(companions);
    } catch (error) {
      console.error("Error fetching companions:", error);
      res.status(500).json({ message: "Failed to fetch companions" });
    }
  });

  // AI-powered companion recommendations
  app.get('/api/companions/recommendations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const recommendations = await storage.getPersonalizedRecommendations(userId);
      res.json(recommendations);
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // Trending and popular companions
  app.get('/api/companions/trending', async (req, res) => {
    try {
      const trending = await storage.getTrendingCompanions();
      res.json(trending);
    } catch (error) {
      console.error("Error fetching trending companions:", error);
      res.status(500).json({ message: "Failed to fetch trending companions" });
    }
  });

  app.get('/api/companions/:id', async (req, res) => {
    try {
      const companion = await storage.getCompanion(req.params.id);
      if (!companion) {
        return res.status(404).json({ message: "Companion not found" });
      }

      const reviews = await storage.getCompanionReviews(req.params.id);
      res.json({ ...companion, reviews });
    } catch (error) {
      console.error("Error fetching companion:", error);
      res.status(500).json({ message: "Failed to fetch companion" });
    }
  });

  // Call routes
  app.post('/api/calls', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const callData = insertCallSchema.parse({
        ...req.body,
        clientId: userId,
      });

      // Verify user has sufficient coins
      const user = await storage.getUser(userId);
      const companion = await storage.getCompanion(callData.companionId);
      
      if (!user || !companion) {
        return res.status(404).json({ message: "User or companion not found" });
      }

      const estimatedCost = parseFloat(companion.ratePerMinute) * 10; // Estimate 10 minutes
      if (user.coinBalance < estimatedCost) {
        return res.status(400).json({ message: "Insufficient coins" });
      }

      const call = await storage.createCall(callData);
      res.json(call);
    } catch (error) {
      console.error("Error creating call:", error);
      res.status(500).json({ message: "Failed to create call" });
    }
  });

  app.put('/api/calls/:id', isAuthenticated, async (req: any, res) => {
    try {
      const callId = req.params.id;
      const updates = req.body;

      // If ending call, calculate total cost and deduct coins
      if (updates.status === 'completed' && updates.durationMinutes) {
        const call = await storage.getCall(callId);
        if (!call) {
          return res.status(404).json({ message: "Call not found" });
        }

        const totalCost = parseFloat(call.ratePerMinute) * updates.durationMinutes;
        const coinsDeducted = Math.ceil(totalCost / 0.15); // Assuming 1 coin = ₹0.15

        updates.totalCost = totalCost.toString();
        updates.coinsDeducted = coinsDeducted;

        // Deduct coins from client
        await storage.updateUserCoinBalance(call.clientId, -coinsDeducted);

        // Add earnings to companion
        const companion = await storage.getCompanion(call.companionId);
        if (companion) {
          const companionEarnings = totalCost * 0.75; // 75% to companion, 25% platform fee
          await storage.updateCompanion(call.companionId, {
            totalEarnings: (parseFloat(companion.totalEarnings) + companionEarnings).toString(),
            withdrawableBalance: (parseFloat(companion.withdrawableBalance) + companionEarnings).toString(),
            totalMinutesCompleted: companion.totalMinutesCompleted + updates.durationMinutes,
          });

          // Create earnings transaction
          await storage.createTransaction({
            userId: companion.userId,
            type: 'earnings',
            amount: companionEarnings.toString(),
            coinAmount: coinsDeducted,
            description: `Earnings from ${updates.durationMinutes} minute call`,
            relatedCallId: callId,
          });
        }

        // Create payment transaction for client
        await storage.createTransaction({
          userId: call.clientId,
          type: 'call_payment',
          amount: totalCost.toString(),
          coinAmount: -coinsDeducted,
          description: `Payment for ${updates.durationMinutes} minute call`,
          relatedCallId: callId,
        });
      }

      const updatedCall = await storage.updateCall(callId, updates);
      res.json(updatedCall);
    } catch (error) {
      console.error("Error updating call:", error);
      res.status(500).json({ message: "Failed to update call" });
    }
  });

  app.get('/api/calls/history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let calls;
      if (user.userType === 'companion') {
        const companion = await storage.getCompanionByUserId(userId);
        calls = companion ? await storage.getCompanionCalls(companion.id) : [];
      } else {
        calls = await storage.getUserCalls(userId);
      }

      res.json(calls);
    } catch (error) {
      console.error("Error fetching call history:", error);
      res.status(500).json({ message: "Failed to fetch call history" });
    }
  });

  // Review routes
  app.post('/api/reviews', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        clientId: userId,
      });

      const review = await storage.createReview(reviewData);
      res.json(review);
    } catch (error) {
      console.error("Error creating review:", error);
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  // Gift routes
  app.get('/api/gifts', async (req, res) => {
    try {
      const gifts = await storage.getGifts();
      res.json(gifts);
    } catch (error) {
      console.error("Error fetching gifts:", error);
      res.status(500).json({ message: "Failed to fetch gifts" });
    }
  });

  app.post('/api/gifts/send', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { receiverId, giftId, callId } = req.body;

      // Verify user has sufficient coins and gift exists
      const [user, gifts] = await Promise.all([
        storage.getUser(userId),
        storage.getGifts(),
      ]);

      const gift = gifts.find(g => g.id === giftId);
      if (!user || !gift) {
        return res.status(404).json({ message: "User or gift not found" });
      }

      if (user.coinBalance < gift.coinCost) {
        return res.status(400).json({ message: "Insufficient coins" });
      }

      // Create gift transaction
      const transaction = await storage.createGiftTransaction({
        senderId: userId,
        receiverId,
        giftId,
        callId,
        coinCost: gift.coinCost,
      });

      // Deduct coins from sender
      await storage.updateUserCoinBalance(userId, -gift.coinCost);

      // Add earnings to receiver
      const companion = await storage.getCompanion(receiverId);
      if (companion) {
        const giftEarnings = gift.coinCost * 0.15 * 0.9; // Convert to rupees and take 10% commission
        await storage.updateCompanion(receiverId, {
          withdrawableBalance: (parseFloat(companion.withdrawableBalance) + giftEarnings).toString(),
        });
      }

      res.json(transaction);
    } catch (error) {
      console.error("Error sending gift:", error);
      res.status(500).json({ message: "Failed to send gift" });
    }
  });

  // Coin purchase routes
  app.post("/api/create-payment-intent", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing unavailable. Please configure Stripe keys." });
      }

      const { coinPackage } = req.body;
      
      // Define coin packages
      const packages = {
        small: { coins: 500, bonus: 50, price: 75 },
        medium: { coins: 1000, bonus: 150, price: 140 },
        large: { coins: 2500, bonus: 500, price: 330 },
      };

      const selectedPackage = packages[coinPackage as keyof typeof packages];
      if (!selectedPackage) {
        return res.status(400).json({ message: "Invalid coin package" });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: selectedPackage.price * 100, // Convert to paise
        currency: "inr",
        metadata: {
          userId: req.user.claims.sub,
          coins: (selectedPackage.coins + selectedPackage.bonus).toString(),
          package: coinPackage,
        },
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  // Razorpay payment routes for Indian users (UPI, Cards, Wallets)
  app.post("/api/razorpay/create-order", isAuthenticated, async (req: any, res) => {
    try {
      if (!razorpay) {
        return res.status(503).json({ message: "Razorpay payments unavailable. Please configure Razorpay keys." });
      }

      const { coinPackage } = req.body;
      
      // Define coin packages (same as Stripe)
      const packages = {
        small: { coins: 500, bonus: 50, price: 75 },
        medium: { coins: 1000, bonus: 150, price: 140 },
        large: { coins: 2500, bonus: 500, price: 330 },
      };

      const selectedPackage = packages[coinPackage as keyof typeof packages];
      if (!selectedPackage) {
        return res.status(400).json({ message: "Invalid coin package" });
      }

      const order = await razorpay.orders.create({
        amount: selectedPackage.price * 100, // Amount in paise
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
        notes: {
          userId: req.user.claims.sub,
          coins: (selectedPackage.coins + selectedPackage.bonus).toString(),
          package: coinPackage,
        },
      });

      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        coins: selectedPackage.coins + selectedPackage.bonus,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating Razorpay order: " + error.message });
    }
  });

  // Razorpay payment verification
  app.post('/api/razorpay/verify', isAuthenticated, async (req: any, res) => {
    try {
      if (!razorpay) {
        return res.status(503).json({ message: "Razorpay verification unavailable" });
      }

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, coins } = req.body;
      const userId = req.user.claims.sub;

      // Verify payment signature
      const crypto = require('crypto');
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                      .update(body.toString())
                                      .digest('hex');

      if (expectedSignature === razorpay_signature) {
        // Payment verified, add coins to user balance
        await storage.updateUserCoinBalance(userId, parseInt(coins));

        // Create transaction record
        await storage.createTransaction({
          userId,
          type: 'coin_purchase',
          amount: req.body.amount,
          coinAmount: parseInt(coins),
          description: `Purchased ${coins} coins via Razorpay`,
          stripePaymentIntentId: razorpay_payment_id, // Reusing field for Razorpay payment ID
        });

        res.json({ success: true, message: "Payment verified and coins added" });
      } else {
        res.status(400).json({ success: false, message: "Payment verification failed" });
      }
    } catch (error: any) {
      res.status(500).json({ message: "Error verifying payment: " + error.message });
    }
  });

  // Webhook to handle successful payments
  app.post('/api/stripe-webhook', async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ message: "Payment processing unavailable" });
    }

    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
      console.log(`Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const { userId, coins } = paymentIntent.metadata;

      // Add coins to user balance
      await storage.updateUserCoinBalance(userId, parseInt(coins));

      // Create transaction record
      await storage.createTransaction({
        userId,
        type: 'coin_purchase',
        amount: (paymentIntent.amount / 100).toString(),
        coinAmount: parseInt(coins),
        description: `Purchased ${coins} coins`,
        stripePaymentIntentId: paymentIntent.id,
      });
    }

    res.json({ received: true });
  });

  // Analytics routes
  app.get('/api/companion/analytics', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const companion = await storage.getCompanionByUserId(userId);

      if (!companion) {
        return res.status(404).json({ message: "Companion profile not found" });
      }

      const [todayEarnings, weekEarnings, monthEarnings] = await Promise.all([
        storage.getCompanionEarnings(companion.id, 'today'),
        storage.getCompanionEarnings(companion.id, 'week'),
        storage.getCompanionEarnings(companion.id, 'month'),
      ]);

      res.json({
        todayEarnings,
        weekEarnings,
        monthEarnings,
        totalEarnings: companion.totalEarnings,
        withdrawableBalance: companion.withdrawableBalance,
        totalMinutes: companion.totalMinutesCompleted,
        averageRating: companion.averageRating,
        totalReviews: companion.totalReviews,
      });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Withdrawal routes
  app.post('/api/withdrawals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const companion = await storage.getCompanionByUserId(userId);

      if (!companion) {
        return res.status(404).json({ message: "Companion profile not found" });
      }

      const { amount, bankAccountNumber, ifscCode, upiId } = req.body;
      
      if (parseFloat(amount) > parseFloat(companion.withdrawableBalance)) {
        return res.status(400).json({ message: "Insufficient withdrawable balance" });
      }

      const withdrawal = await storage.createWithdrawal({
        companionId: companion.id,
        amount,
        bankAccountNumber,
        ifscCode,
        upiId,
      });

      // Update companion's withdrawable balance
      await storage.updateCompanion(companion.id, {
        withdrawableBalance: (parseFloat(companion.withdrawableBalance) - parseFloat(amount)).toString(),
      });

      res.json(withdrawal);
    } catch (error) {
      console.error("Error creating withdrawal:", error);
      res.status(500).json({ message: "Failed to create withdrawal request" });
    }
  });

  // Referral and Affiliate Program routes
  app.post('/api/referral/create-code', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { code, bonusCoins, referrerBonus, maxUses, expiresAt } = req.body;

      // Check if code already exists
      const existingCode = await storage.getReferralCodeByCode(code);
      if (existingCode) {
        return res.status(400).json({ message: "Referral code already exists" });
      }

      const referralCode = await storage.createReferralCode({
        code,
        referrerId: userId,
        bonusCoins: bonusCoins || 100,
        referrerBonus: referrerBonus || 50,
        maxUses: maxUses || 100,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.json(referralCode);
    } catch (error) {
      console.error("Error creating referral code:", error);
      res.status(500).json({ message: "Failed to create referral code" });
    }
  });

  app.post('/api/referral/use-code', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { code } = req.body;

      const referralCode = await storage.getReferralCodeByCode(code);
      if (!referralCode) {
        return res.status(404).json({ message: "Invalid referral code" });
      }

      if (!referralCode.isActive) {
        return res.status(400).json({ message: "Referral code is inactive" });
      }

      if (referralCode.expiresAt && new Date(referralCode.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Referral code has expired" });
      }

      if (referralCode.currentUses >= (referralCode.maxUses || 0)) {
        return res.status(400).json({ message: "Referral code usage limit reached" });
      }

      if (referralCode.referrerId === userId) {
        return res.status(400).json({ message: "Cannot use your own referral code" });
      }

      // Check if user has already used a referral code
      const existingUsage = await storage.getReferralUsageByUserId(userId);
      if (existingUsage) {
        return res.status(400).json({ message: "You have already used a referral code" });
      }

      // Apply referral bonuses
      await storage.updateUserCoinBalance(userId, referralCode.bonusCoins);
      await storage.updateUserCoinBalance(referralCode.referrerId, referralCode.referrerBonus);

      // Create referral usage record
      const referralUsage = await storage.createReferralUsage({
        codeId: referralCode.id,
        referrerId: referralCode.referrerId,
        referredUserId: userId,
        status: 'completed',
        bonusCoinsAwarded: referralCode.bonusCoins,
        referrerBonusAwarded: referralCode.referrerBonus,
      });

      // Update referral code usage count
      await storage.updateReferralCodeUsage(referralCode.id, referralCode.currentUses + 1);

      // Create transaction records
      await Promise.all([
        storage.createTransaction({
          userId,
          type: 'referral_bonus',
          amount: '0',
          coinAmount: referralCode.bonusCoins,
          description: `Referral bonus from code: ${code}`,
        }),
        storage.createTransaction({
          userId: referralCode.referrerId,
          type: 'referral_bonus',
          amount: '0',
          coinAmount: referralCode.referrerBonus,
          description: `Referral reward for code: ${code}`,
        }),
      ]);

      res.json({ message: "Referral code applied successfully", coinsAwarded: referralCode.bonusCoins });
    } catch (error) {
      console.error("Error using referral code:", error);
      res.status(500).json({ message: "Failed to apply referral code" });
    }
  });

  app.get('/api/referral/my-codes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const codes = await storage.getUserReferralCodes(userId);
      res.json(codes);
    } catch (error) {
      console.error("Error fetching referral codes:", error);
      res.status(500).json({ message: "Failed to fetch referral codes" });
    }
  });

  // Affiliate program routes
  app.post('/api/affiliate/join', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Check if user already has affiliate profile
      const existingAffiliate = await storage.getAffiliateByUserId(userId);
      if (existingAffiliate) {
        return res.status(400).json({ message: "You are already part of the affiliate program" });
      }

      // Generate unique affiliate code
      const affiliateCode = `AFF_${userId.slice(0, 8)}_${Date.now()}`;

      const affiliateProfile = await storage.createAffiliateProfile({
        userId,
        affiliateCode,
        commissionRate: '5.00', // 5% default
      });

      res.json(affiliateProfile);
    } catch (error) {
      console.error("Error joining affiliate program:", error);
      res.status(500).json({ message: "Failed to join affiliate program" });
    }
  });

  app.get('/api/affiliate/my-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getAffiliateByUserId(userId);
      
      if (!profile) {
        return res.status(404).json({ message: "Affiliate profile not found" });
      }

      res.json(profile);
    } catch (error) {
      console.error("Error fetching affiliate profile:", error);
      res.status(500).json({ message: "Failed to fetch affiliate profile" });
    }
  });

  app.get('/api/affiliate/earnings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const affiliate = await storage.getAffiliateByUserId(userId);
      
      if (!affiliate) {
        return res.status(404).json({ message: "Affiliate profile not found" });
      }

      const earnings = await storage.getAffiliateEarnings(affiliate.id);
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching affiliate earnings:", error);
      res.status(500).json({ message: "Failed to fetch affiliate earnings" });
    }
  });

  // Subscription routes
  app.get('/api/subscription/plans', async (req, res) => {
    try {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    } catch (error) {
      console.error("Error fetching subscription plans:", error);
      res.status(500).json({ message: "Failed to fetch subscription plans" });
    }
  });

  app.get('/api/subscription/current', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const subscription = await storage.getUserSubscription(userId);
      res.json(subscription);
    } catch (error) {
      console.error("Error fetching user subscription:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  app.post('/api/subscription/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { planId } = req.body;

      // In a real app, this would integrate with Stripe subscriptions
      const subscription = await storage.createUserSubscription({
        userId,
        planId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      res.json(subscription);
    } catch (error) {
      console.error("Error creating subscription:", error);
      res.status(500).json({ message: "Failed to create subscription" });
    }
  });

  app.post('/api/subscription/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = await storage.cancelUserSubscription(userId);
      res.json(result);
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  // WebSocket setup for real-time features
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('New WebSocket connection');

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        
        switch (data.type) {
          case 'register':
            // Register user for signaling
            signalingUsers.set(data.userId, ws);
            break;
            
          case 'call-offer':
          case 'call-answer':
          case 'ice-candidate':
            // Forward WebRTC signaling messages
            const targetWs = signalingUsers.get(data.targetUserId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(message);
            }
            break;
            
          case 'call-end':
            // Handle call end
            const endTargetWs = signalingUsers.get(data.targetUserId);
            if (endTargetWs && endTargetWs.readyState === WebSocket.OPEN) {
              endTargetWs.send(message);
            }
            break;
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      // Remove user from signaling registry
      for (const [userId, userWs] of Array.from(signalingUsers.entries())) {
        if (userWs === ws) {
          signalingUsers.delete(userId);
          break;
        }
      }
    });
  });

  return httpServer;
}
