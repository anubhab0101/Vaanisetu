# Overview

Vannisetu is a companion video calling platform that connects clients with verified companions for video conversations. The application facilitates secure, paid video calls with features like virtual gifts, coin-based payments, and comprehensive companion profiles. It serves as a social platform where users can either become companions (offering video call services) or clients (purchasing video call time with companions).

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **React Single Page Application**: Built with TypeScript and React using Wouter for routing instead of React Router
- **UI Framework**: Shadcn/ui components with Radix UI primitives for consistent design system
- **Styling**: Tailwind CSS with a dark theme and custom color variables
- **State Management**: TanStack React Query for server state management and caching
- **Forms**: React Hook Form with Zod schema validation for type-safe form handling
- **Real-time Communication**: WebRTC for video calls with WebSocket signaling for call coordination

## Backend Architecture
- **Express.js Server**: Node.js backend with TypeScript using ESM modules
- **Database ORM**: Drizzle ORM with PostgreSQL dialect for type-safe database operations
- **Authentication**: Replit's OpenID Connect (OIDC) authentication system with Passport.js
- **Session Management**: Express sessions stored in PostgreSQL with connect-pg-simple
- **File Uploads**: Multer middleware for handling companion profile images
- **WebSocket Server**: Built-in WebSocket server for real-time signaling during video calls

## Data Architecture
- **PostgreSQL Database**: Primary data store using Neon serverless PostgreSQL
- **Schema Design**: Comprehensive relational schema with users, companions, calls, reviews, gifts, and transaction tables
- **Enums**: Type-safe enums for user types, verification status, availability status, call status, and transaction types
- **Relationships**: Well-defined foreign key relationships between entities with proper indexing

## Authentication & Authorization
- **Replit OAuth Integration**: Uses Replit's authentication system for secure user login
- **Role-Based Access**: Users can be clients, companions, or admins with different permissions
- **Session Security**: HTTP-only cookies with secure flags and proper session expiration
- **Profile Verification**: Government ID verification system for companion profiles

## Payment & Monetization System
- **Stripe Integration**: Full payment processing for coin purchases with subscription support
- **Virtual Currency**: Coin-based system for call payments and virtual gifts
- **Earnings Management**: Companion earnings tracking with withdrawal capabilities
- **Transaction History**: Comprehensive transaction logging for all financial activities

## Real-time Features
- **WebRTC Video Calls**: Peer-to-peer video communication with STUN server configuration
- **WebSocket Signaling**: Custom signaling server for WebRTC connection establishment
- **Live Call Management**: Real-time call status updates and duration tracking
- **Virtual Gifts**: Real-time gift sending during active video calls

## Build & Development
- **Vite Build System**: Fast development server with HMR and optimized production builds
- **TypeScript Configuration**: Strict type checking with path aliases for clean imports
- **ESBuild**: Server bundling for production deployment
- **Development Tooling**: Runtime error overlays and Replit-specific development enhancements

# External Dependencies

## Database & Infrastructure
- **Neon Database**: Serverless PostgreSQL hosting with connection pooling
- **Replit Platform**: Hosting environment with built-in authentication and development tools

## Payment Processing
- **Stripe**: Payment processing for coin purchases, subscriptions, and webhook handling
- **Stripe Elements**: Client-side payment form components with React integration

## Communication & Media
- **WebRTC**: Browser-native peer-to-peer video calling capabilities
- **Google STUN Servers**: ICE server configuration for NAT traversal in video calls

## UI & Styling
- **Radix UI**: Headless UI components for accessibility and keyboard navigation
- **Tailwind CSS**: Utility-first CSS framework with custom design tokens
- **Lucide React**: Icon library for consistent iconography throughout the application

## Development & Build Tools
- **Vite**: Build tool and development server with React plugin support
- **Drizzle Kit**: Database schema management and migration tools
- **TSX**: TypeScript execution for development server runtime