import { Category } from '../types';

export interface FilterField {
  id: string; // matches product field key
  label: string;
  type: 'select' | 'text' | 'number';
  placeholder?: string;
  dependsOn?: string; // parent element ID, e.g. 'brand'
  options?: string[]; // static list of options
}

export const CATEGORY_FILTERS: Record<Category, FilterField[]> = {
  Phones: [
    {
      id: 'brand',
      label: 'Brand',
      type: 'select',
      options: ['Apple', 'Samsung', 'Google', 'Tecno', 'Infinix', 'Nokia', 'Huawei', 'Xiaomi', 'OnePlus', 'Oppo', 'Vivo']
    },
    {
      id: 'model',
      label: 'Model / Variant',
      type: 'select',
      dependsOn: 'brand',
      placeholder: 'Select Brand first'
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Ghana Used', 'Foreign Used', 'Refurbished']
    },
    {
      id: 'storage',
      label: 'Storage Capacity',
      type: 'select',
      options: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
    },
    {
      id: 'ram',
      label: 'RAM Size',
      type: 'select',
      options: ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB']
    },
    {
      id: 'color',
      label: 'Color',
      type: 'select',
      options: ['Black', 'White', 'Silver', 'Gold', 'Blue', 'Green', 'Red', 'Gray']
    },
    {
      id: 'network',
      label: 'Network Type',
      type: 'select',
      options: ['5G Network', '4G LTE', '3G / 2G Only']
    }
  ],
  Vehicles: [
    {
      id: 'brand',
      label: 'Make / Brand',
      type: 'select',
      options: ['Toyota', 'Honda', 'Mercedes-Benz', 'BMW', 'Nissan', 'Kia', 'Hyundai', 'Ford', 'Lexus', 'Mazda']
    },
    {
      id: 'model',
      label: 'Model',
      type: 'select',
      dependsOn: 'brand',
      placeholder: 'Select Make first'
    },
    {
      id: 'year',
      label: 'Manufacture Year',
      type: 'select',
      options: ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015', '2013', '2010', '2008', '2005']
    },
    {
      id: 'transmission',
      label: 'Transmission',
      type: 'select',
      options: ['Automatic', 'Manual', 'Semi-Automatic']
    },
    {
      id: 'fuelType',
      label: 'Fuel Type',
      type: 'select',
      options: ['Petrol', 'Diesel', 'Hybrid', 'Electric']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Foreign Used', 'Ghana Used']
    }
  ],
  Property: [
    {
      id: 'propertyType',
      label: 'Property Type',
      type: 'select',
      options: ['Apartment & Flat', 'Self-Contain Room', 'Chamber and Hall', 'Detached House', 'Commercial Property', 'Office Space', 'Land / Plot']
    },
    {
      id: 'bedrooms',
      label: 'Bedrooms',
      type: 'select',
      options: ['1 Bedroom', '2 Bedrooms', '3 Bedrooms', '4 Bedrooms', '5 Bedrooms', '6+ Bedrooms']
    },
    {
      id: 'bathrooms',
      label: 'Bathrooms',
      type: 'select',
      options: ['1 Bathroom', '2 Bathrooms', '3 Bathrooms', '4 Bathrooms', '5+ Bathrooms']
    },
    {
      id: 'furnishedStatus',
      label: 'Furnished Status',
      type: 'select',
      options: ['Fully Furnished', 'Semi-Furnished', 'Unfurnished']
    },
    {
      id: 'parkingAvailability',
      label: 'Parking Space',
      type: 'select',
      options: ['Available', 'Not Available']
    }
  ],
  Electronics: [
    {
      id: 'brand',
      label: 'Brand',
      type: 'select',
      options: ['Sony', 'Samsung', 'LG', 'Hisense', 'TCL', 'Panasonic', 'Philips', 'Canon', 'Nikon', 'Xiaomi']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Foreign Used / Refurbished', 'Ghana Used']
    },
    {
      id: 'warrantyStatus',
      label: 'Warranty Status',
      type: 'select',
      options: ['Under Warranty', 'No Warranty / Expired']
    }
  ],
  Laptops: [
    {
      id: 'brand',
      label: 'Brand',
      type: 'select',
      options: ['Apple', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Microsoft', 'MSI', 'Samsung']
    },
    {
      id: 'model',
      label: 'Model / Series',
      type: 'select',
      dependsOn: 'brand',
      placeholder: 'Select Laptop Brand first'
    },
    {
      id: 'processor',
      label: 'Processor Core',
      type: 'select',
      options: ['Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'Apple M1', 'Apple M2', 'Apple M3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9']
    },
    {
      id: 'ram',
      label: 'RAM Size',
      type: 'select',
      options: ['4GB RAM', '8GB RAM', '16GB RAM', '32GB RAM', '64GB RAM']
    },
    {
      id: 'storage',
      label: 'Storage Capacity',
      type: 'select',
      options: ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD', '500GB HDD', '1TB HDD']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Foreign Used', 'Ghana Used', 'Refurbished']
    }
  ],
  Fashion: [
    {
      id: 'gender',
      label: 'Target Gender',
      type: 'select',
      options: ['Men', 'Women', 'Unisex', 'Kids']
    },
    {
      id: 'itemType',
      label: 'Item Type',
      type: 'select',
      options: ['Clothing', 'Shoes & Sneakers', 'Watches & Jewelry', 'Bags & Purses', 'Sunglasses', 'Accessories']
    },
    {
      id: 'size',
      label: 'Size / Dimension',
      type: 'select',
      options: ['S', 'M', 'L', 'XL', 'XXL', '38', '39', '40', '41', '42', '43', '44', '45', '46']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Pre-Owned (Gently Used)', 'Vintage / Antique']
    }
  ],
  'Home Appliances': [
    {
      id: 'applianceType',
      label: 'Appliance Type',
      type: 'select',
      options: ['Refrigerator & Freezer', 'Microwave & Oven', 'Washing Machine', 'Air Conditioner', 'Blender & Mixer', 'Television', 'Gas Cooker', 'Water Dispenser', 'Other Appliance']
    },
    {
      id: 'brand',
      label: 'Brand',
      type: 'select',
      options: ['Samsung', 'LG', 'Hisense', 'Bosch', 'Philips', 'Panasonic', 'Kenwood', 'Midea', 'Binatone']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Foreign Used (Home Used)', 'Ghana Used']
    }
  ],
  'Beauty and Care': [
    {
      id: 'productType',
      label: 'Product Type',
      type: 'select',
      options: ['Skincare', 'Haircare', 'Makeup', 'Fragrances & Perfumes', 'Personal Hygiene', 'Tools & Accessories']
    },
    {
      id: 'brand',
      label: 'Brand / Label',
      type: 'select',
      options: ['Fenty Beauty', 'The Ordinary', 'Nivea', 'Cetaphil', 'L\'Oreal', 'Maybelline', 'Chanel', 'Dior', 'Victoria\'s Secret', 'Mary Kay', 'Vaseline']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New / Sealed', 'Open Box / Never Used']
    }
  ],
  Games: [
    {
      id: 'platform',
      label: 'Platform Console',
      type: 'select',
      options: ['Sony PlayStation 5', 'Sony PlayStation 4', 'Xbox Series X/S', 'Xbox One', 'Nintendo Switch', 'Gaming PC']
    },
    {
      id: 'gameType',
      label: 'Category',
      type: 'select',
      options: ['Video Game Disc', 'Console Device', 'Controller / Gamepad', 'Gaming Headset', 'Other Accessory']
    },
    {
      id: 'condition',
      label: 'Condition',
      type: 'select',
      options: ['Brand New', 'Foreign Used', 'Ghana Used']
    }
  ],
  Services: [
    {
      id: 'serviceType',
      label: 'Service Specialization',
      type: 'select',
      options: ['IT, Computer & Software', 'Photography & Video Services', 'Fashion & Tailoring Services', 'Home Repair & Plumbing', 'Cleaning & Laundry Services', 'Tutoring & Training', 'Catering & Event Planning', 'Beauty & Hair Styling', 'Courier & Logistics Services']
    },
    {
      id: 'pricingModel',
      label: 'Pricing Basis',
      type: 'select',
      options: ['Fixed / Flat Rate', 'Hourly Rate', 'Contact for Quotation', 'Negotiable On Site']
    }
  ],
  Other: [
    {
      id: 'condition',
      label: 'Condition / Status',
      type: 'select',
      options: ['New / Sealed', 'Lightly Used', 'Fair Condition']
    }
  ]
};

// Hierarchical Brand to Model mapping
export const BRAND_MODELS_DATA: Record<string, string[]> = {
  // Phone Brands
  Apple: [
    'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17 Plus', 'iPhone 17', 'iPhone SE 4',
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13 mini', 'iPhone 13',
    'iPhone SE (3rd Gen)',
    'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12 mini', 'iPhone 12',
    'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11',
    'iPhone SE (2nd Gen)',
    'iPhone XS Max', 'iPhone XS', 'iPhone XR', 'iPhone X',
    'iPhone 8 Plus', 'iPhone 8',
    'iPhone 7 Plus', 'iPhone 7',
    'iPhone SE (1st Gen)',
    'iPhone 6s Plus', 'iPhone 6s', 'iPhone 6 Plus', 'iPhone 6',
    'iPhone 5s'
  ],
  Samsung: [
    'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S23 Ultra', 
    'Galaxy S23', 'Galaxy S22 Ultra', 'Galaxy S21 FE', 'Galaxy A54 5G', 'Galaxy A34', 'Galaxy A15'
  ],
  Google: ['Pixel 9 Pro XL', 'Pixel 9', 'Pixel 8 Pro', 'Pixel 8', 'Pixel 7 Pro', 'Pixel 7', 'Pixel 6a'],
  Tecno: ['Camon 30 Pro', 'Camon 30', 'Spark 20 Pro+', 'Spark 20', 'Phantom V Fold', 'Phantom X2'],
  Infinix: ['Note 40 Pro', 'Note 40', 'Hot 40 Pro', 'Hot 40', 'Zero 30 5G', 'Smart 8'],
  Xiaomi: ['Redmi Note 13 Pro+', 'Redmi Note 13', 'Redmi 13C', 'Xiaomi 14 Ultra', 'POCO X6 Pro'],
  Huawei: ['Pura 70 Ultra', 'P60 Pro', 'Mate 60 Pro', 'Nova 11', 'Y9a'],
  OnePlus: ['OnePlus 12', 'OnePlus 12R', 'OnePlus 11', 'Nord CE 4'],
  Oppo: ['Reno 11 Pro', 'Reno 11', 'A78 5G', 'Find X7 Ultra'],
  Vivo: ['V30 Pro', 'V30', 'Y36 5G', 'X100 Pro'],
  Nokia: ['Nokia G42', 'Nokia XR21', 'Nokia C32', 'Nokia 105 (Classic)'],

  // Vehicle Marques
  Toyota: ['Corolla', 'Camry', 'RAV4', 'Highlander', 'Yaris', 'Land Cruiser', 'Hilux Pick-up', 'Vitz', 'Prado'],
  Honda: ['Civic', 'Accord', 'CR-V', 'Fit', 'Pilot', 'Insight', 'HR-V'],
  'Mercedes-Benz': ['C-Class (C300/C350)', 'E-Class', 'S-Class', 'GLA', 'GLC 300', 'GLE 350', 'G-Wagon', 'Sprinter'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X5', 'X6', 'X3', 'i4'],
  Nissan: ['Rogue', 'Sentra', 'Altima', 'Murano', 'Navara Pick-up', 'Pathfinder', 'Versa'],
  Kia: ['Forte', 'Sportage', 'Sorento', 'Rio', 'Optima', 'Picanto', 'Cerato'],
  Hyundai: ['Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Accent', 'Ioniq 5', 'Kona'],
  Ford: ['Explorer', 'Escape', 'Mustang', 'F-150', 'Focus', 'Ranger Pick-up'],
  Lexus: ['RX 350', 'IS 250', 'ES 350', 'GX 460', 'LX 570'],
  Mazda: ['Mazda 3', 'Mazda 6', 'CX-5', 'CX-9', 'Demio'],

  // Laptop Brands
  'Apple (Laptops)': [
    'MacBook Pro 16" (M3/Pro/Max, 2023)',
    'MacBook Pro 14" (M3/Pro/Max, 2023)',
    'MacBook Pro 16" (M2/Pro/Max, 2023)',
    'MacBook Pro 14" (M2/Pro/Max, 2023)',
    'MacBook Pro 16" (M1/Pro/Max, 2021)',
    'MacBook Pro 14" (M1/Pro/Max, 2021)',
    'MacBook Pro 13" (M2, 2022)',
    'MacBook Pro 13" (M1, 2020)',
    'MacBook Pro 16" (Intel, 2019)',
    'MacBook Pro 15" (Touch Bar, 2016-2019)',
    'MacBook Pro 13" (Touch Bar, 2016-2020)',
    'MacBook Pro 15" Retina (Mid 2012-2015)',
    'MacBook Pro 13" Retina (Late 2012-2015)',
    'MacBook Pro 15" Unibody (Mid 2012)',
    'MacBook Pro 13" Unibody (Mid 2012)',
    'MacBook Air 15" (M3, 2024)',
    'MacBook Air 13" (M3, 2024)',
    'MacBook Air 15" (M2, 2023)',
    'MacBook Air 13" (M2, 2022)',
    'MacBook Air 13" (M1, 2020)',
    'MacBook Air 13" (Retina, 2018-2020)',
    'MacBook Air 13" (Classic, 2012-2017)',
    'MacBook Air 11" (Classic, 2012-2015)',
    'MacBook 12" Retina (2015-2017)'
  ],
  Dell: ['Inspiron', 'Latitude', 'XPS', 'Precision', 'Vostro', 'Alienware', 'G Series'],
  HP: ['EliteBook', 'ProBook', 'Spectre', 'Envy', 'Pavilion', 'Omen', 'Victus'],
  Lenovo: ['ThinkPad', 'IdeaPad', 'Yoga', 'Legion', 'ThinkBook', 'Flex'],
  Asus: ['ZenBook', 'VivoBook', 'ROG (Republic of Gamers)', 'TUF Gaming', 'ExpertBook', 'ProArt'],
  Acer: ['Aspire', 'Swift', 'Spin', 'Nitro', 'Predator', 'TravelMate', 'Enduro'],
  Microsoft: ['Surface Laptop', 'Surface Pro', 'Surface Go', 'Surface Book', 'Surface Studio']
};

export function getModelsForBrand(brand: string, category: Category): string[] {
  if (!brand) return [];
  const cleanBrand = brand.trim().toLowerCase();
  
  if (category === 'Laptops' && cleanBrand === 'apple') {
    return BRAND_MODELS_DATA['Apple (Laptops)'] || [];
  }
  
  // Find key case-insensitively
  const matchingKey = Object.keys(BRAND_MODELS_DATA).find(
    k => k.toLowerCase() === cleanBrand
  );
  
  return matchingKey ? BRAND_MODELS_DATA[matchingKey] : [];
}
