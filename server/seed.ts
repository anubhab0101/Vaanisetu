import { db } from './db';
import { gifts, subscriptionPlans } from '@shared/schema';

export async function seedDatabase() {
  console.log('🌱 Seeding database...');

  try {
    // Seed subscription plans
    const plans = [
      {
        name: 'Basic',
        description: 'Perfect for casual users',
        priceMonthly: '199.00',
        features: ['100 bonus coins per month', 'Basic customer support', 'Standard matching'],
        maxCallsPerMonth: 10,
        bonusCoinsPerMonth: 100,
        isActive: true,
      },
      {
        name: 'Premium',
        description: 'Enhanced experience with priority features',
        priceMonthly: '499.00',
        features: ['500 bonus coins per month', 'Priority customer support', 'Advanced matching', 'Profile verification badge'],
        maxCallsPerMonth: 50,
        bonusCoinsPerMonth: 500,
        isActive: true,
      },
      {
        name: 'VIP',
        description: 'Ultimate companion experience',
        priceMonthly: '999.00',
        features: ['1500 bonus coins per month', 'VIP customer support', 'AI-powered matching', 'Exclusive companions', 'Priority booking'],
        maxCallsPerMonth: 200,
        bonusCoinsPerMonth: 1500,
        isActive: true,
      },
    ];

    await db.insert(subscriptionPlans).values(plans).onConflictDoNothing();

    // Seed virtual gifts
    const giftCategories = [
      // Romantic gifts
      { name: 'Red Rose', emoji: '🌹', coinCost: 50, category: 'romantic' },
      { name: 'Heart', emoji: '❤️', coinCost: 25, category: 'romantic' },
      { name: 'Kiss', emoji: '💋', coinCost: 30, category: 'romantic' },
      { name: 'Love Letter', emoji: '💌', coinCost: 75, category: 'romantic' },
      { name: 'Ring', emoji: '💍', coinCost: 500, category: 'romantic' },

      // Food & Drink
      { name: 'Coffee', emoji: '☕', coinCost: 20, category: 'food' },
      { name: 'Cake', emoji: '🎂', coinCost: 100, category: 'food' },
      { name: 'Champagne', emoji: '🍾', coinCost: 200, category: 'food' },
      { name: 'Cocktail', emoji: '🍸', coinCost: 80, category: 'food' },
      { name: 'Chocolate', emoji: '🍫', coinCost: 60, category: 'food' },

      // Luxury gifts
      { name: 'Diamond', emoji: '💎', coinCost: 1000, category: 'luxury' },
      { name: 'Crown', emoji: '👑', coinCost: 800, category: 'luxury' },
      { name: 'Sports Car', emoji: '🏎️', coinCost: 2000, category: 'luxury' },
      { name: 'Yacht', emoji: '🛥️', coinCost: 5000, category: 'luxury' },
      { name: 'Mansion', emoji: '🏰', coinCost: 10000, category: 'luxury' },

      // Fun & Entertainment
      { name: 'Party', emoji: '🎉', coinCost: 150, category: 'fun' },
      { name: 'Music', emoji: '🎵', coinCost: 40, category: 'fun' },
      { name: 'Game', emoji: '🎮', coinCost: 120, category: 'fun' },
      { name: 'Movie', emoji: '🎬', coinCost: 90, category: 'fun' },
      { name: 'Dancing', emoji: '💃', coinCost: 70, category: 'fun' },

      // Nature & Animals
      { name: 'Butterfly', emoji: '🦋', coinCost: 35, category: 'nature' },
      { name: 'Unicorn', emoji: '🦄', coinCost: 300, category: 'nature' },
      { name: 'Rainbow', emoji: '🌈', coinCost: 85, category: 'nature' },
      { name: 'Star', emoji: '⭐', coinCost: 45, category: 'nature' },
      { name: 'Moon', emoji: '🌙', coinCost: 65, category: 'nature' },
    ];

    await db.insert(gifts).values(giftCategories).onConflictDoNothing();

    console.log('✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase().then(() => process.exit(0));
}