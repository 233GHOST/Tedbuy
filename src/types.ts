export interface User {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  photoUrl?: string;
  joinDate: string;
  role: 'buyer' | 'seller' | 'both';
  followingSellers?: string[]; // IDs of sellers this user follows
}

export type Category = 'Phones' | 'Laptops' | 'Fashion' | 'Home Appliances' | 'Vehicles' | 'Other';

export interface Product {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerPhoto?: string;
  sellerJoinDate: string;
  title: string;
  description: string;
  price: number;
  category: Category;
  location: string;
  brand?: string;
  condition?: string;
  images: string[]; // 1 to 5 images (urls or base64)
  createdAt: string;
  viewsCount: number;
}

export interface Chat {
  id: string;
  productId: string;
  productTitle: string;
  productPrice: number;
  productImage: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  lastMessageText: string;
  lastMessageTime: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
  read: boolean;
}
