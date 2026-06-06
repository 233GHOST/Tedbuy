import { User, Product, Chat, Message, Review } from './types';

export const SEED_USERS: User[] = [
  {
    id: 'user_john',
    username: 'John\'s Store',
    email: 'john@tedbuy.com',
    phoneNumber: '+233241234567',
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
    joinDate: 'Jan 2026',
    role: 'both',
    followingSellers: []
  },
  {
    id: 'user_kelvin',
    username: 'Kelvin Tech',
    email: 'kelvin@tedbuy.com',
    phoneNumber: '+233247654321',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
    joinDate: 'March 2026',
    role: 'both',
    followingSellers: []
  },
  {
    id: 'user_salim',
    username: 'Salim Osei',
    email: 'salim@tedbuy.com',
    phoneNumber: '+233209876543',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80',
    joinDate: 'June 2026',
    role: 'both',
    followingSellers: []
  },
  {
    id: 'user_jane',
    username: 'Jane Smith',
    email: 'jane@tedbuy.com',
    phoneNumber: '+233271122334',
    photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80',
    joinDate: 'May 2026',
    role: 'both',
    followingSellers: ['user_john']
  }
];

export const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod_1',
    sellerId: 'user_kelvin',
    sellerName: 'Kelvin Tech',
    sellerPhoto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
    sellerJoinDate: 'March 2026',
    title: 'iPhone 14 Pro - 256GB Deep Purple',
    description: 'Used for 8 months. Excellent condition, looks exactly like new. Battery health is at 91%. Comes with the original box and Apple USB-C to Lightning Cable. Screen protector and silicon case already applied. Selling because I upgraded to newer models.',
    price: 7500,
    category: 'Phones',
    location: 'Accra',
    brand: 'Apple',
    condition: 'Used (Like New)',
    images: [
      'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1565849211560-544875f44a8a?auto=format&fit=crop&w=600&q=80'
    ],
    createdAt: '2026-06-01T12:00:00Z',
    viewsCount: 142
  },
  {
    id: 'prod_2',
    sellerId: 'user_kelvin',
    sellerName: 'Kelvin Tech',
    sellerPhoto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
    sellerJoinDate: 'March 2026',
    title: 'MacBook Pro 14" M2 Pro (16GB/512GB)',
    description: 'Superfast work machine in elegant Space Gray. M2 Pro chip with 10-core CPU and 16-core GPU. perfect for coding, design, and video editing. Includes original 67W fast charger, original braided MagSafe cable, and a high-quality leather laptop sleeve. Zero scratches or dents.',
    price: 15400,
    category: 'Laptops',
    location: 'Kumasi',
    brand: 'Apple',
    condition: 'Used (Like New)',
    images: [
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?auto=format&fit=crop&w=600&q=80'
    ],
    createdAt: '2026-06-02T10:15:00Z',
    viewsCount: 89
  },
  {
    id: 'prod_3',
    sellerId: 'user_john',
    sellerName: 'John\'s Store',
    sellerPhoto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
    sellerJoinDate: 'Jan 2026',
    title: 'Retro Nike Air Jordan 1 High OG',
    description: 'Original Chicago Colorway, Size 43 (US 9.5). Sparingly worn, light creasing on the toe-box, but generally pristine. Bought directly from Nike UK. Box and extra pairs of white and red laces are intact. Perfect for collectors or streetwear enthusiasts.',
    price: 1800,
    category: 'Fashion',
    location: 'Tema, Accra',
    brand: 'Nike',
    condition: 'Used (Good)',
    images: [
      'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=600&q=80'
    ],
    createdAt: '2026-06-03T14:30:00Z',
    viewsCount: 204
  },
  {
    id: 'prod_4',
    sellerId: 'user_salim',
    sellerName: 'Salim Osei',
    sellerPhoto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80',
    sellerJoinDate: 'June 2026',
    title: 'Samsung Double-Door Smart Fridge',
    description: 'Family Hub refrigerator with interactive voice control and screen interface. Built-in cameras let you see what is inside from anywhere. Excellent cooling performance, minor scuffs on the side cabinet but the digital inverter is super silent and has a 10-year warranty. 320L capacity.',
    price: 9800,
    category: 'Home Appliances',
    location: 'West Legon, Accra',
    brand: 'Samsung',
    condition: 'Used (Good)',
    images: [
      'https://images.unsplash.com/photo-1571175432268-bf1f15865181?auto=format&fit=crop&w=600&q=80'
    ],
    createdAt: '2026-06-04T08:00:00Z',
    viewsCount: 35
  },
  {
    id: 'prod_5',
    sellerId: 'user_john',
    sellerName: 'John\'s Store',
    sellerPhoto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
    sellerJoinDate: 'Jan 2026',
    title: 'Toyota Corolla 2018 Sports Edition',
    description: 'Clean domestic registered car. Smooth automatic transmission, cold air conditioning, fuel-efficient 1.8L 4-cylinder engine. Serviced regularly every 5,000 km, no engine issues, sound suspension. Original alloy rims, rear spoiler and reverse camera installed. Serious buyers only.',
    price: 85000,
    category: 'Vehicles',
    location: 'East Legon, Accra',
    brand: 'Toyota',
    condition: 'Used (Fair)',
    images: [
      'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1617788138017-80ad40651399?auto=format&fit=crop&w=600&q=80'
    ],
    createdAt: '2026-06-04T11:20:00Z',
    viewsCount: 412
  }
];

export const SEED_CHATS: Chat[] = [
  {
    id: 'chat_jane_kelvin_prod1',
    productId: 'prod_1',
    productTitle: 'iPhone 14 Pro - 256GB Deep Purple',
    productPrice: 7500,
    productImage: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=600&q=80',
    buyerId: 'user_jane',
    sellerId: 'user_kelvin',
    buyerName: 'Jane Smith',
    sellerName: 'Kelvin Tech',
    lastMessageText: 'Can I pay GHS 7,000 for it? I can pay tomorrow morning.',
    lastMessageTime: '2026-06-04T12:05:00Z'
  }
];

export const SEED_MESSAGES: Message[] = [
  {
    id: 'msg_1',
    chatId: 'chat_jane_kelvin_prod1',
    senderId: 'user_jane',
    recipientId: 'user_kelvin',
    text: 'Hello, is this iPhone 14 Pro still available?',
    createdAt: '2026-06-04T11:45:00Z',
    read: true
  },
  {
    id: 'msg_2',
    chatId: 'chat_jane_kelvin_prod1',
    senderId: 'user_kelvin',
    recipientId: 'user_jane',
    text: 'Hi Jane, yes it is! Very clean and ready for pick-up.',
    createdAt: '2026-06-04T11:50:00Z',
    read: true
  },
  {
    id: 'msg_3',
    chatId: 'chat_jane_kelvin_prod1',
    senderId: 'user_jane',
    recipientId: 'user_kelvin',
    text: 'Great details! What is your final price? Can you do GHS 6,800?',
    createdAt: '2026-06-04T11:55:00Z',
    read: true
  },
  {
    id: 'msg_4',
    chatId: 'chat_jane_kelvin_prod1',
    senderId: 'user_kelvin',
    recipientId: 'user_jane',
    text: 'Ah, GHS 6,800 is a bit too low for its condition. My rock bottom is GHS 7,100.',
    createdAt: '2026-06-04T12:00:00Z',
    read: true
  },
  {
    id: 'msg_5',
    chatId: 'chat_jane_kelvin_prod1',
    senderId: 'user_jane',
    recipientId: 'user_kelvin',
    text: 'Can I pay GHS 7,000 for it? I can pay tomorrow morning.',
    createdAt: '2026-06-04T12:05:00Z',
    read: false
  }
];

export const SEED_REVIEWS: Review[] = [
  {
    id: 'rev_1',
    sellerId: 'user_john',
    buyerId: 'user_jane',
    buyerName: 'Jane Smith',
    buyerPhoto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80',
    rating: 5,
    comment: 'Purchased a pair of Jordans. Super clean, authentic, and John was incredibly friendly during pickup!',
    createdAt: '2026-06-03T18:00:00Z',
    productTitle: 'Retro Nike Air Jordan 1 High OG'
  },
  {
    id: 'rev_2',
    sellerId: 'user_kelvin',
    buyerId: 'user_salim',
    buyerName: 'Salim Osei',
    buyerPhoto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80',
    rating: 4,
    comment: 'Great tech shop. Screen on the MacBook was pristine. Response time on chat was slightly delayed, but delivery was safe.',
    createdAt: '2026-06-02T16:45:00Z',
    productTitle: 'MacBook Pro 14" M2 Pro (16GB/512GB)'
  }
];

