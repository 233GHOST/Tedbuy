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
    'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S24 FE',
    'Galaxy S23 Ultra', 'Galaxy S23+', 'Galaxy S23', 'Galaxy S23 FE',
    'Galaxy S22 Ultra', 'Galaxy S22+', 'Galaxy S22',
    'Galaxy S21 Ultra', 'Galaxy S21+', 'Galaxy S21', 'Galaxy S21 FE',
    'Galaxy S20 Ultra', 'Galaxy S20+', 'Galaxy S20', 'Galaxy S20 FE',
    'Galaxy S10+', 'Galaxy S10', 'Galaxy S10e', 'Galaxy S9+', 'Galaxy S9',
    'Galaxy Note 20 Ultra', 'Galaxy Note 20', 'Galaxy Note 10+', 'Galaxy Note 10', 'Galaxy Note 9',
    'Galaxy Z Fold6', 'Galaxy Z Flip6', 'Galaxy Z Fold5', 'Galaxy Z Flip5', 'Galaxy Z Fold4', 'Galaxy Z Flip4',
    'Galaxy A55 5G', 'Galaxy A35 5G', 'Galaxy A25 5G', 'Galaxy A15 5G', 'Galaxy A15', 'Galaxy A05s', 'Galaxy A05',
    'Galaxy A54 5G', 'Galaxy A34 5G', 'Galaxy A24', 'Galaxy A14 5G', 'Galaxy A14', 'Galaxy A04s', 'Galaxy A04e',
    'Galaxy A53 5G', 'Galaxy A33 5G', 'Galaxy A23 5G', 'Galaxy A23', 'Galaxy A13 5G', 'Galaxy A13', 'Galaxy A03s',
    'Galaxy A73 5G', 'Galaxy A52s 5G', 'Galaxy A52 5G', 'Galaxy A52', 'Galaxy A32 5G', 'Galaxy A32', 'Galaxy A12',
    'Galaxy M54 5G', 'Galaxy M34 5G', 'Galaxy M14 5G', 'Galaxy M53 5G', 'Galaxy M33 5G', 'Galaxy M13'
  ],
  Google: [
    'Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 9 Pro Fold',
    'Pixel 8 Pro', 'Pixel 8', 'Pixel 8a',
    'Pixel 7 Pro', 'Pixel 7', 'Pixel 7a',
    'Pixel 6 Pro', 'Pixel 6', 'Pixel 6a',
    'Pixel 5', 'Pixel 5a 5G',
    'Pixel 4 XL', 'Pixel 4', 'Pixel 4a 5G', 'Pixel 4a',
    'Pixel 3 XL', 'Pixel 3', 'Pixel 3a XL', 'Pixel 3a'
  ],
  Tecno: [
    'Phantom V Fold2 5G', 'Phantom V Flip2 5G', 'Phantom V Fold 5G', 'Phantom V Flip 5G',
    'Phantom X2 Pro 5G', 'Phantom X2 5G', 'Phantom X Pro', 'Phantom X',
    'Camon 30 Premier 5G', 'Camon 30 Pro 5G', 'Camon 30 5G', 'Camon 30', 'Camon 30S Pro',
    'Camon 20 Premier 5G', 'Camon 20 Pro 5G', 'Camon 20 Pro', 'Camon 20', 'Camon 20 Avocado',
    'Camon 19 Pro 5G', 'Camon 19 Pro', 'Camon 19 Neo', 'Camon 19',
    'Camon 18 Premier', 'Camon 18P', 'Camon 18i', 'Camon 18T', 'Camon 18',
    'Camon 17 Pro', 'Camon 17P', 'Camon 17', 'Camon 16 Premier', 'Camon 16 Pro', 'Camon 15',
    'Spark 20 Pro+', 'Spark 20 Pro', 'Spark 20 5G', 'Spark 20', 'Spark 20C', 'Spark Go 2024',
    'Spark 10 Pro', 'Spark 10 5G', 'Spark 10', 'Spark 10C', 'Spark Go 2023',
    'Spark 9 Pro', 'Spark 9T', 'Spark 9', 'Spark 8 Pro', 'Spark 8P', 'Spark 8C', 'Spark Go',
    'Pova 6 Pro 5G', 'Pova 6 5G', 'Pova 6 Neo', 'Pova 5 Pro 5G', 'Pova 5', 'Pova Neo 3', 'Pova 4 Pro', 'Pova 4',
    'Pop 8', 'Pop 7 Pro', 'Pop 7', 'Pop 6 Pro', 'Pop 6', 'Pop 5 Pro', 'Pop 5'
  ],
  Infinix: [
    'GT 20 Pro 5G', 'GT 10 Pro 5G',
    'Zero 30 5G', 'Zero 30 4G', 'Zero Ultra 5G', 'Zero 20', 'Zero X Pro', 'Zero X Neo', 'Zero 8i', 'Zero 8',
    'Note 40 Pro+ 5G', 'Note 40 Pro 5G', 'Note 40 Pro', 'Note 40 5G', 'Note 40',
    'Note 30 Pro', 'Note 30 5G', 'Note 30 VIP', 'Note 30', 'Note 30i',
    'Note 12 VIP', 'Note 12 Pro 5G', 'Note 12 Pro', 'Note 12 G96', 'Note 12i', 'Note 12',
    'Note 11 Pro', 'Note 11s', 'Note 11', 'Note 10 Pro', 'Note 10', 'Note 8', 'Note 8i', 'Note 7',
    'Hot 40 Pro', 'Hot 40', 'Hot 40i', 'Hot 30 5G', 'Hot 30', 'Hot 30i', 'Hot 30 Play',
    'Hot 20 5G', 'Hot 20 Pro', 'Hot 20', 'Hot 20i', 'Hot 20 Play',
    'Hot 12 Pro', 'Hot 12 Play', 'Hot 12i', 'Hot 12', 'Hot 11s NFC', 'Hot 11', 'Hot 10T', 'Hot 10s', 'Hot 10 Play', 'Hot 10',
    'Smart 8 Pro', 'Smart 8 Plus', 'Smart 8', 'Smart 7 Plus', 'Smart 7 HD', 'Smart 7',
    'Smart 6 Plus', 'Smart 6 HD', 'Smart 6', 'Smart 5 Pro', 'Smart 5'
  ],
  Xiaomi: [
    'Xiaomi 14 Ultra', 'Xiaomi 14 Pro', 'Xiaomi 14', 'Xiaomi 13T Pro', 'Xiaomi 13T', 'Xiaomi 13 Ultra', 'Xiaomi 13 Pro', 'Xiaomi 13',
    'Redmi Note 13 Pro+ 5G', 'Redmi Note 13 Pro 5G', 'Redmi Note 13 Pro 4G', 'Redmi Note 13 5G', 'Redmi Note 13 4G',
    'Redmi Note 12 Pro+ 5G', 'Redmi Note 12 Pro 5G', 'Redmi Note 12S', 'Redmi Note 12 5G', 'Redmi Note 12 4G',
    'Redmi Note 11 Pro+ 5G', 'Redmi Note 11 Pro 5G', 'Redmi Note 11 Pro 4G', 'Redmi Note 11S 5G', 'Redmi Note 11S', 'Redmi Note 11',
    'Redmi Note 10 Pro', 'Redmi Note 10s', 'Redmi Note 10 5G', 'Redmi Note 10', 'Redmi Note 9 Pro', 'Redmi Note 9',
    'Redmi 13C 5G', 'Redmi 13C', 'Redmi 13', 'Redmi 12 5G', 'Redmi 12', 'Redmi 12C', 'Redmi 10C', 'Redmi 10 2022', 'Redmi 10', 'Redmi 9C', 'Redmi 9A',
    'Redmi A3', 'Redmi A2+', 'Redmi A2', 'Redmi A1+',
    'POCO F6 Pro', 'POCO F6', 'POCO X6 Pro 5G', 'POCO X6 5G', 'POCO M6 Pro', 'POCO F5 Pro', 'POCO F5', 'POCO X5 Pro 5G', 'POCO X5'
  ],
  Huawei: [
    'Pura 70 Ultra', 'Pura 70 Pro', 'Pura 70', 'P60 Pro', 'P60', 'P50 Pro', 'P50 Pocket', 'P40 Pro+', 'P40 Pro', 'P40 Lite', 'P30 Pro', 'P30 Lite',
    'Mate 65 Pro', 'Mate 60 Pro+', 'Mate 60 Pro', 'Mate 60', 'Mate X5 Fold', 'Mate 50 Pro', 'Mate 40 Pro', 'Mate 30 Pro',
    'Nova 12 Ultra', 'Nova 12s', 'Nova 12i', 'Nova 11 Pro', 'Nova 11', 'Nova 11i', 'Nova 10 Pro', 'Nova 10', 'Nova 10 SE', 'Nova Y91', 'Nova Y90', 'Nova Y70',
    'Nova 9 SE', 'Nova 9', 'Nova 8i', 'Nova 7i', 'Nova 5T',
    'Y9a', 'Y9s', 'Y9 Prime 2019', 'Y9 2019', 'Y8p', 'Y7p', 'Y6p', 'Y5p', 'Y7 Prime', 'Y6 Prime'
  ],
  OnePlus: [
    'OnePlus 12', 'OnePlus 12R', 'OnePlus Open (Fold)', 'OnePlus 11 5G', 'OnePlus 11R',
    'OnePlus 10 Pro 5G', 'OnePlus 10T 5G', 'OnePlus 10R', 'OnePlus 9 Pro 5G', 'OnePlus 9 5G', 'OnePlus 9R',
    'OnePlus 8T', 'OnePlus 8 Pro', 'OnePlus 8', 'OnePlus Nord 4 5G', 'OnePlus Nord CE4 Lite 5G', 'OnePlus Nord CE 4',
    'OnePlus Nord 3 5G', 'OnePlus Nord CE 3 5G', 'OnePlus Nord CE 3 Lite 5G', 'OnePlus Nord 2T 5G', 'OnePlus Nord N30 5G', 'OnePlus Nord N20 SE'
  ],
  Oppo: [
    'Find X7 Ultra', 'Find X7', 'Find N3 Fold', 'Find N3 Flip', 'Find X6 Pro', 'Find X5 Pro',
    'Reno 12 Pro', 'Reno 12', 'Reno 12F 5G', 'Reno 11 Pro 5G', 'Reno 11 5G', 'Reno 11F 5G',
    'Reno 10 Pro+ 5G', 'Reno 10 Pro 5G', 'Reno 10 5G', 'Reno 8 Pro 5G', 'Reno 8 5G', 'Reno 8T 5G', 'Reno 8T', 'Reno 7 Pro 5G', 'Reno 7 5G',
    'A98 5G', 'A79 5G', 'A78 5G', 'A78', 'A59 5G', 'A58 4G', 'A38', 'A18', 'A96', 'A76', 'A57 2022', 'A17k', 'A17', 'A16k', 'A16', 'A15s', 'A15'
  ],
  Vivo: [
    'X100 Ultra', 'X100 Pro', 'X100', 'X90 Pro+', 'X90 Pro', 'X90', 'X Fold3 Pro',
    'V40 Pro', 'V40', 'V30 Pro 5G', 'V30 5G', 'V30e 5G', 'V30 Lite 5G', 'V29 Pro 5G', 'V29 5G', 'V29e 5G', 'V29 Lite 5G',
    'V27 Pro 5G', 'V27 5G', 'V27e', 'V25 Pro 5G', 'V25 5G', 'V25e', 'V23 Pro 5G', 'V23 5G', 'V23e', 'V21 5G', 'V21', 'V20 2021', 'V20',
    'Y100 5G', 'Y38 5G', 'Y36 5G', 'Y36', 'Y28 5G', 'Y28', 'Y27s', 'Y27 5G', 'Y27 4G', 'Y17s', 'Y02t', 'Y16', 'Y22s', 'Y22', 'Y15s', 'Y30', 'Y20'
  ],
  Nokia: [
    'Nokia XR21', 'Nokia XR20 5G', 'Nokia X30 5G', 'Nokia G42 5G', 'Nokia G22', 'Nokia G21', 'Nokia G11 Plus', 'Nokia G11',
    'Nokia C32', 'Nokia C22', 'Nokia C12 Pro', 'Nokia C12', 'Nokia C31', 'Nokia C30', 'Nokia C21 Plus', 'Nokia C20', 'Nokia C10',
    'Nokia 8.3 5G', 'Nokia 7.2', 'Nokia 6.2', 'Nokia 5.4', 'Nokia 3.4',
    'Nokia 105 4G (2023)', 'Nokia 105 (Classic)', 'Nokia 110 4G', 'Nokia 220 4G', 'Nokia 2660 Flip', 'Nokia 5710 XpressAudio', 'Nokia 8210 4G', 'Nokia 5310', 'Nokia 6310'
  ],

  // Vehicle Marques
  Toyota: ['Corolla', 'Camry', 'RAV4', 'Highlander', 'Yaris', 'Land Cruiser', 'Hilux Pick-up', 'Vitz', 'Prado', 'Tacoma', 'Avalon', 'Sienna', 'Prius', 'Fortuner', 'Rush', 'C-HR'],
  Honda: ['Civic', 'Accord', 'CR-V', 'Fit', 'Pilot', 'Insight', 'HR-V', 'Odyssey', 'Crosstour', 'City', 'Vezel'],
  'Mercedes-Benz': ['C-Class (C300/C350)', 'E-Class (E300/E350)', 'S-Class (S500/S550)', 'GLA 250', 'GLC 300', 'GLE 350/GLE 450', 'GLS 450/GLS 550', 'G-Wagon (G63/G550)', 'CLA 250', 'A-Class', 'Sprinter Bus/Van', 'V-Class'],
  BMW: ['3 Series (320i/328i/335i)', '5 Series (528i/535i/540i)', '7 Series (740li/750li)', 'X5 (xDrive35i/40i)', 'X6', 'X3', 'X4', 'X1', 'i4', 'iX', 'M3', 'M5'],
  Nissan: ['Rogue', 'Sentra', 'Altima', 'Murano', 'Navara Pick-up', 'Pathfinder', 'Versa', 'X-Trail', 'Juke', 'Maxima', 'Frontier', 'Qashqai'],
  Kia: ['Forte', 'Sportage', 'Sorento', 'Rio', 'Optima', 'Picanto', 'Cerato', 'Stinger', 'Soul', 'K5', 'Telluride'],
  Hyundai: ['Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Accent', 'Ioniq 5', 'Kona', 'Creta', 'Palisade', 'Veloster', 'Getz', 'i10'],
  Ford: ['Explorer', 'Escape', 'Mustang', 'F-150', 'Focus', 'Ranger Pick-up', 'Edge', 'Fusion', 'Expedition', 'Fiesta'],
  Lexus: ['RX 350', 'IS 250/IS 350', 'ES 350', 'GX 460', 'LX 570', 'NX 200t/NX 300', 'UX 200', 'GS 350'],
  Mazda: ['Mazda 3', 'Mazda 6', 'CX-5', 'CX-9', 'Demio', 'CX-3', 'CX-30', 'MX-5 Miata'],

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
    'MacBook 12" Retina (2015-2017)',
    'iMac 24" M3 / M1',
    'Mac Mini M2 / M1',
    'Mac Studio M2 / M1 Ultra'
  ],
  Dell: [
    'Latitude 5490 / 5480 / 5450', 'Latitude 7490 / 7480 / 7450', 'Latitude 5420 / 5430 / 5440',
    'Latitude 7420 / 7430 / 7440', 'Latitude 3520 / 3510 / 3540', 'Latitude 5590 / 5580', 'Latitude 7390 2-in-1',
    'XPS 13 9315 / 9320 Plus', 'XPS 13 9310 / 9305', 'XPS 15 9530 / 9520 / 9510', 'XPS 17 9730 / 9720 / 9710',
    'Inspiron 15 3520 / 3511 / 3501', 'Inspiron 15 5510 / 5515 / 5502', 'Inspiron 14 5410 2-in-1 / 5420', 'Inspiron 16 Plus / 7620',
    'Precision 3560 / 3570 / 3580 Workstation', 'Precision 5560 / 5570 / 5580 Mobile Workstation', 'Precision 7560 / 7670 Workstation',
    'Vostro 3510 / 3520 / 3500', 'Vostro 3400 / 3420', 'Vostro 5410 / 5510',
    'G15 5530 / 5520 / 5515 Gaming', 'G16 7630 / 7620 Gaming', 'Alienware m16 / m18 / m15 R7', 'Alienware x16 / x14 / x15 R2'
  ],
  HP: [
    'EliteBook 840 G3 / G4 / G5', 'EliteBook 840 G6 / G7 / G8', 'EliteBook 840 G9 / G10',
    'EliteBook 830 G5 / G6 / G7 / G8', 'EliteBook 850 G5 / G6 / G7 / G8', 'EliteBook 1040 G8 / G9 x360', 'EliteBook Folio 1040 G3 / G4',
    'ProBook 450 G8 / G9 / G10', 'ProBook 440 G8 / G9 / G10', 'ProBook 450 G5 / G6 / G7', 'ProBook 440 G5 / G6 / G7',
    'ProBook 650 G4 / G5 / G8', 'ProBook 430 G8 / G7 / G5', 'ProBook x360 11 G5 / G6 Education',
    'Spectre x360 14 / 16 / 13.5 Premium', 'Spectre Folio 13', 'Envy x360 15 / 13 Convertible', 'Envy 16 / 17 Creator Laptop',
    'Pavilion 15-eg / 15-eh', 'Pavilion x360 14', 'Pavilion Aero 13', 'Pavilion Gaming 15',
    'Victus 15-fa / 15-fb Gaming', 'Victus 16 Gaming', 'Omen 16 / 17 Gaming', 'Omen Transcend 16',
    'HP Notebook 15-dw / 15-dy Essential', 'HP 250 G8 / G9 / G10 Business Laptop', 'HP 14s-dq / 14s-cf', 'HP Stream 11 / 14'
  ],
  Lenovo: [
    'ThinkPad T480 / T470 / T460', 'ThinkPad T490 / T490s', 'ThinkPad T14 Gen 1 / Gen 2 / Gen 3',
    'ThinkPad X1 Carbon Gen 9 / Gen 10 / Gen 11', 'ThinkPad X1 Yoga Gen 6 / Gen 7 / Gen 8',
    'ThinkPad L14 / L15 / L13 Yoga', 'ThinkPad E14 / E15 / E16', 'ThinkPad P15 / P16 / P1 Gen 5 Workstation',
    'ThinkPad X280 / X390 / X13 Gen 2', 'ThinkPad T580 / T590 / T15',
    'IdeaPad 3 15ITL6 / 15ALC6', 'IdeaPad 5 14IAL7 / 15ABA7', 'IdeaPad Slim 3 / Slim 5 Gen 8',
    'IdeaPad Gaming 3 15IHU6 / 15ACH6', 'IdeaPad Duet 3 / 5 Chromebook',
    'Yoga 7i 14 / 16 Gen 8', 'Yoga 9i 14 Convertible', 'Yoga Slim 7 Carbon / Pro', 'Yoga 6 AMD 2-in-1',
    'Legion 5 Pro 16ARH7H / 16IAH7H', 'Legion 5 15ACH6H / 15IAH7', 'Legion 7i / Pro 7i', 'Legion Slim 5 / Slim 7',
    'ThinkBook 15 G2 / G4 / G6 ITL', 'ThinkBook 14 G2 / G4 / G6', 'ThinkBook 14s Yoga 2-in-1'
  ],
  Asus: [
    'ZenBook 14 OLED UX3402 / UM3402', 'ZenBook S 13 OLED UM5302', 'ZenBook Pro Duo 15 UX582', 'ZenBook Flip 14 UN5401', 'ZenBook 13 UX325',
    'VivoBook 15 X1502 / X1504', 'VivoBook Pro 15 OLED K6502', 'VivoBook S 14 / S 15 OLED', 'VivoBook Flip 14 TP470', 'VivoBook Go 14 / 15',
    'ROG Zephyrus G14 GA402 / GA401', 'ROG Zephyrus G16 / M16 Gaming', 'ROG Strix G16 / SCAR 16 Gaming', 'ROG Flow X13 / Z13 convertible',
    'TUF Gaming A15 FA506 / FA507', 'TUF Gaming F15 FX506 / FX507', 'TUF Gaming A17 / F17 Larger screen',
    'ExpertBook B1 B1400 / B1500', 'ExpertBook B9 B9400 Business', 'ProArt Studiobook 16 OLED H7604'
  ],
  Acer: [
    'Aspire 3 A315-58 / A315-59', 'Aspire 5 A515-56 / A515-57', 'Aspire 7 A715 Gaming', 'Aspire Vero AV15 eco-friendly', 'Aspire Lite AL15',
    'Nitro 5 AN515-57 / AN515-58', 'Nitro V 15 ANV15-51', 'Predator Helios 16 PH16-71', 'Predator Helios Neo 16 PHN16-71', 'Predator Triton 14 / 17',
    'Swift Go 14 SFG14-71 / SFG14-72 OLED', 'Swift 3 SF314', 'Swift Edge 16 OLED SFE16', 'Swift X 14 SFX14',
    'Spin 3 / Spin 5 Convertible', 'TravelMate P2 TMP215', 'TravelMate P4 TMP414', 'TravelMate Spin B3'
  ],
  Microsoft: [
    'Surface Laptop 5 13.5" / 15"', 'Surface Laptop 4', 'Surface Laptop 3',
    'Surface Pro 9 Intel / SQ3', 'Surface Pro 8', 'Surface Pro 7 / 7+',
    'Surface Laptop Go 3 / Go 2 / Go', 'Surface Pro Go 3 / Go 4',
    'Surface Laptop Studio 2 / Studio 1', 'Surface Book 3 / Book 2'
  ],
  MSI: [
    'Katana 15 B13V / B12V Gaming', 'Cyborg 15 A12V Thin Gaming', 'Thin GF63 12V / 11V',
    'Raider GE78 HX / GE68 HX Enthusiast', 'Stealth 16 / 14 Studio Slim Gaming', 'Vector GP78 / GP68 HX Gaming',
    'Pulse 15 / Pulse 17 Gaming', 'Sword 15 / Sword 17 Gaming',
    'Creator Z16 / Z17 Hiroshi Fujiwara Edition', 'Summit E14 Flip / E16 Flip 2-in-1', 'Prestige 14 / 16 Evo Studio',
    'Modern 14 C13M / Modern 15 B13M Thin Client'
  ],
  Samsung_Laptops: [
    'Galaxy Book4 Ultra (Intel Core Ultra 9)', 'Galaxy Book4 Pro 360 2-in-1', 'Galaxy Book4 Pro 14" / 16" OLED', 'Galaxy Book4 360', 'Galaxy Book4 NP750',
    'Galaxy Book3 Ultra RTX 4070', 'Galaxy Book3 Pro 360', 'Galaxy Book3 Pro 14" / 16"', 'Galaxy Book3 360', 'Galaxy Book3 NP750',
    'Galaxy Book2 Pro 360', 'Galaxy Book2 Pro', 'Galaxy Book Go Snapdragon 7c', 'Galaxy Book Flex / Ion QLED'
  ]
};

export function getModelsForBrand(brand: string, category: Category): string[] {
  if (!brand) return [];
  const cleanBrand = brand.trim().toLowerCase();
  
  if (category === 'Laptops') {
    if (cleanBrand === 'apple') {
      return BRAND_MODELS_DATA['Apple (Laptops)'] || [];
    }
    if (cleanBrand === 'samsung') {
      return BRAND_MODELS_DATA['Samsung_Laptops'] || [];
    }
  }
  
  // Find key case-insensitively
  const matchingKey = Object.keys(BRAND_MODELS_DATA).find(
    k => k.toLowerCase() === cleanBrand
  );
  
  return matchingKey ? BRAND_MODELS_DATA[matchingKey] : [];
}
