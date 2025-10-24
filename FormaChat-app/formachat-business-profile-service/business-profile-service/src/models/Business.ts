import mongoose, { Schema, Document } from "mongoose";

export interface IBusiness extends Document {
  userId: string;
  basicInfo: {
    businessName: string,
    businessDescription: string,
    businessType: string,
    operatingHours: string,
    location: string,
    timezone?: string,
  };
  productsServices: {
    offerings: string;
    popularItems: Array<{
      name: string;
      description?: string;
      price?: number;
    }>;
    serviceDelivery: string[];
    pricingDisplay?: {
      canDiscussPricing: boolean;
      pricingNote?: string;
    };
  };
  customerSupport: {
    faqs: Array<{
      question: string;
      answer: string;
    }>;
    policies: {
      refundPolicy: string;
      cancellationPolicy?: string;
      importantPolicies?: string;
    };
    chatbotTone: string;
    chatbotGreeting?: string;
    chatbotRestrictions?: string;
  };
  contactEscalation: {
    contactMethods: Array<{
      method: string;
      value: string;
    }>;
    escalationContact: {
      name: string;
      email: string;
      phone?: string;
    };
    chatbotCapabilities: string[];
  };
  // for PRO+ Tiers 
  files?: {
    documents: Array<{
      fileName: string;
      fileUrl: string;
      uploadDate: Date;
      fileSize: number;
    }>;
    images: Array<{
      fileName: string;
      fileUrl: string;
      uploadDate: Date;
      category?: string;
    }>;
  };
  // Vector DB info
  vectorInfo:{
    namespace: string; // `business_id`
    lastVectorUpdate: Date;
    vectorStatus: 'pending' | 'completed' | 'failed';
    needsUpdate?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Actual Schema

const BusinessSchema: Schema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  basicInfo: {
    businessName: {
      type: String,
      required: true,
      maxlength: 100,
      trim: true,
    },
    businessDescription: {
      type: String,
      required: true,
      maxlength: 500,
    },
    businessType: {
      type: String,
      required: true,
      enum: [
        'E-commerce', 'Real Estate', 'Restaurant', 'Hotel',
        'Service-based', 'Tech/SaaS', 'Healthcare', 'Education', 'Other'
      ]
    },
    operatingHours: {
      type: String,
      required: true
    },
    location: {
      type: String,
      required: true
    },
    timezone: String
  },
  productsServices: {
    offerings: {
      type: String,
      required: true,
      maxlength: 1000
    },
    popularItems: [{
      name: String,
      description: String,
      price: Number
    }],
    serviceDelivery: [{
      type: String,
      enum: ['Delivery', 'Pickup', 'In-person', 'Online/Virtual'], 
    }],
    pricingDisplay : {
      canDiscussPricing: {
        type: Boolean,
        default: true 
      },
      pricingNote: String
    }
  },
  customerSupport: {
    faqs: [{
      question: String,
      answer: String,
    }],
    policies: {
      refundPolicy: {
        type: String,
        required: true 
      },
      cancellationPolicy: String,
      importantPolicies: String 
    },
    chatbotTone: {
      type: String,
      enum: ['Friendly', 'Professional', 'Casual', 'Formal', 'Playful'],
      default: 'Friendly'
    },
    chatbotGreeting: String,
    chatbotRestrictions: String
  },
  contactEscalation: {
    contactMethods: [{
      method: {
        type: String,
        enum: ['Email', 'Phone', 'WhatsApp', 'Live Chat', 'Social Media']
      },
      value: String
    }],
    escalationContact: {
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true 
      },
      phone: String 
    },
    chatbotCapabilities: [{
      type: String,
      enum: ['Answer FAQs', 'Book apointments', 'Generate leads', 'Handle Complaints', 'Provide product info',
        'Process orders'
      ]
    }]
  },
  files: {
    documents: [{
      filename: String,
      fileUrl: String, // Cloud storage URL
      uploadDate: {
        type: Date,
        default: Date.now
      },
      fileSize: Number 
    }],
    images: [{
      filename: String,
      fileUrl: String, // Cloud storage URL
      uploadDate: {
        type: Date,
        default: Date.now 
      },
      category: {
        type: String,
        enum: ['Logo', 'Product', 'StoreFront', 'Team', 'Other']
      }
    }]
  },

  // Vector DB tracking

  vectorInfo: {
    namespace: String,
    lastVectorUpdate: {
      type: Date,
      default: Date.now 
    },
    vectorStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    needsUpdate: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
});

BusinessSchema.pre('save', function(this: IBusiness, next) {
  if (this.isNew) {
    this.vectorInfo.namespace = `business_${this._id}`;
  }
  next()
});

export default mongoose.model<IBusiness>('Business', BusinessSchema);