import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Product, Chat, Message, Category } from '../types';
import { SEED_USERS, SEED_PRODUCTS, SEED_CHATS, SEED_MESSAGES } from '../data';

interface AppContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  users: User[];
  registerUser: (username: string, email?: string, phoneNumber?: string) => User;
  loginUser: (identifier: string) => boolean;
  logoutUser: () => void;
  products: Product[];
  createProduct: (productData: {
    title: string;
    description: string;
    price: number;
    category: Category;
    location: string;
    images: string[];
    brand?: string;
    condition?: string;
  }) => void;
  updateProduct: (id: string, productData: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  chats: Chat[];
  messages: Message[];
  startChat: (productId: string, initialMessage?: string) => string;
  sendMessage: (chatId: string, text: string, optionalSenderId?: string) => void;
  followSeller: (sellerId: string) => void;
  unfollowSeller: (sellerId: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: Category | null;
  setSelectedCategory: (cat: Category | null) => void;
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile';
  setCurrentView: (view: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile') => void;
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;
  selectedSellerId: string | null;
  setSelectedSellerId: (id: string | null) => void;
  switchUserSimulated: (userId: string) => void;
  incrementProductViews: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load state from localStorage or initialize with seed data
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('tedbuy_users');
    return saved ? JSON.parse(saved) : SEED_USERS;
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('tedbuy_products');
    return saved ? JSON.parse(saved) : SEED_PRODUCTS;
  });

  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = localStorage.getItem('tedbuy_chats');
    return saved ? JSON.parse(saved) : SEED_CHATS;
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('tedbuy_messages');
    return saved ? JSON.parse(saved) : SEED_MESSAGES;
  });

  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    const saved = localStorage.getItem('tedbuy_current_user');
    if (saved) return JSON.parse(saved);
    // Default to the buyer 'Jane Smith' for a quick functional onboarding
    const cachedUsers = localStorage.getItem('tedbuy_users');
    const existingUsers = cachedUsers ? JSON.parse(cachedUsers) : SEED_USERS;
    return existingUsers.find((u: User) => u.id === 'user_jane') || existingUsers[3] || null;
  });

  // Navigation and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile'>('browse');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);

  // Synchronize with localStorage
  useEffect(() => {
    localStorage.setItem('tedbuy_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('tedbuy_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('tedbuy_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('tedbuy_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('tedbuy_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('tedbuy_current_user');
    }
  }, [currentUser]);

  // Auth Functions
  const registerUser = (username: string, email?: string, phoneNumber?: string) => {
    const existing = users.find(u => {
      const emailMatches = email && u.email && u.email.toLowerCase() === email.toLowerCase();
      const phoneMatches = phoneNumber && u.phoneNumber && u.phoneNumber === phoneNumber;
      return !!(emailMatches || phoneMatches);
    });

    if (existing) {
      setCurrentUserState(existing);
      return existing;
    }

    const newUser: User = {
      id: `user_${Date.now()}`,
      username,
      email: email || undefined,
      phoneNumber: phoneNumber || undefined,
      joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      role: 'both',
      followingSellers: [],
      photoUrl: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 999999)}?auto=format&fit=crop&w=120&q=80`
    };
    setUsers(prev => [...prev, newUser]);
    setCurrentUserState(newUser);
    return newUser;
  };

  const loginUser = (identifier: string) => {
    const existing = users.find(u => {
      const emailMatches = u.email && u.email.toLowerCase() === identifier.trim().toLowerCase();
      const phoneMatches = u.phoneNumber && u.phoneNumber.trim() === identifier.trim();
      return !!(emailMatches || phoneMatches);
    });
    if (existing) {
      setCurrentUserState(existing);
      return true;
    }
    return false;
  };

  const logoutUser = () => {
    setCurrentUserState(null);
    setCurrentView('browse');
  };

  // Switch Active User (Dev / Testing helper)
  const switchUserSimulated = (userId: string) => {
    const target = users.find(u => u.id === userId);
    if (target) {
      setCurrentUserState(target);
    }
  };

  // Product Listings CRUD
  const createProduct = (productData: {
    title: string;
    description: string;
    price: number;
    category: Category;
    location: string;
    images: string[];
    brand?: string;
    condition?: string;
  }) => {
    if (!currentUser) return;
    const newProduct: Product = {
      id: `prod_${Date.now()}`,
      sellerId: currentUser.id,
      sellerName: currentUser.username,
      sellerPhoto: currentUser.photoUrl,
      sellerJoinDate: currentUser.joinDate,
      ...productData,
      createdAt: new Date().toISOString(),
      viewsCount: 0
    };
    setProducts(prev => [newProduct, ...prev]);
  };

  const updateProduct = (id: string, productData: Partial<Product>) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, ...productData };
      }
      return p;
    }));
  };

  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    // clean up any chats linked to deleted products if desired
  };

  const incrementProductViews = (id: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, viewsCount: p.viewsCount + 1 };
      }
      return p;
    }));
  };

  // Chat Actions
  const startChat = (productId: string, initialMessage?: string) => {
    if (!currentUser) return '';
    const product = products.find(p => p.id === productId);
    if (!product) return '';

    // Check if chat already exists for this product between this buyer and seller
    const existingChat = chats.find(c =>
      c.productId === productId &&
      c.buyerId === currentUser.id &&
      c.sellerId === product.sellerId
    );

    if (existingChat) {
      if (initialMessage) {
        sendMessage(existingChat.id, initialMessage);
      }
      return existingChat.id;
    }

    const newChatId = `chat_${currentUser.id}_${product.sellerId}_${product.id}_${Date.now()}`;
    const newChat: Chat = {
      id: newChatId,
      productId: product.id,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.images[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80',
      buyerId: currentUser.id,
      sellerId: product.sellerId,
      buyerName: currentUser.username,
      sellerName: product.sellerName,
      lastMessageText: initialMessage || 'Chat started',
      lastMessageTime: new Date().toISOString()
    };

    setChats(prev => [newChat, ...prev]);

    if (initialMessage) {
      const newMsg: Message = {
        id: `msg_${Date.now()}`,
        chatId: newChatId,
        senderId: currentUser.id,
        recipientId: product.sellerId,
        text: initialMessage,
        createdAt: new Date().toISOString(),
        read: false
      };
      setMessages(prev => [...prev, newMsg]);
    }

    return newChatId;
  };

  const sendMessage = (chatId: string, text: string, optionalSenderId?: string) => {
    const sender = optionalSenderId ? users.find(u => u.id === optionalSenderId) : currentUser;
    if (!sender) return;

    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex === -1) return;

    const chat = chats[chatIndex];
    const recId = chat.buyerId === sender.id ? chat.sellerId : chat.buyerId;

    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      chatId,
      senderId: sender.id,
      recipientId: recId,
      text,
      createdAt: new Date().toISOString(),
      read: false
    };

    // Update messages
    setMessages(prev => [...prev, newMsg]);

    // Update chat last message
    setChats(prev => prev.map(c => {
      if (c.id === chatId) {
        return {
          ...c,
          lastMessageText: text,
          lastMessageTime: new Date().toISOString()
        };
      }
      return c;
    }));
  };

  // Follow Profiles
  const followSeller = (sellerId: string) => {
    if (!currentUser) return;
    const following = currentUser.followingSellers || [];
    if (!following.includes(sellerId)) {
      const updatedFollowing = [...following, sellerId];
      const updatedUser = { ...currentUser, followingSellers: updatedFollowing };
      setCurrentUserState(updatedUser);
      setUsers(prev => prev.map(u => u.id === currentUser.id ? updatedUser : u));
    }
  };

  const unfollowSeller = (sellerId: string) => {
    if (!currentUser) return;
    const following = currentUser.followingSellers || [];
    const updatedFollowing = following.filter(id => id !== sellerId);
    const updatedUser = { ...currentUser, followingSellers: updatedFollowing };
    setCurrentUserState(updatedUser);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updatedUser : u));
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser: setCurrentUserState,
      users,
      registerUser,
      loginUser,
      logoutUser,
      products,
      createProduct,
      updateProduct,
      deleteProduct,
      chats,
      messages,
      startChat,
      sendMessage,
      followSeller,
      unfollowSeller,
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      currentView,
      setCurrentView,
      selectedProductId,
      setSelectedProductId,
      selectedSellerId,
      setSelectedSellerId,
      switchUserSimulated,
      incrementProductViews
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
