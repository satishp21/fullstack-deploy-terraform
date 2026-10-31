import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Rate from './models/Rate.js';
import Device from './models/Device.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Mongo connected for seeding');

    // Admin user
    const adminEmail = 'admin@jayneticzone.com';
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      const hashed = await bcrypt.hash('Admin@123', 10);
      await User.create({
        name: 'Jaynetic Admin',
        email: adminEmail,
        password: hashed,
        role: 'admin'
      });
      console.log('Created admin user:', adminEmail, 'password: Admin@123');
    } else {
      console.log('Admin user already exists');
    }

    // Clear existing devices and rates
    await Device.deleteMany({});
    await Rate.deleteMany({});
    console.log('Cleared existing devices and rates');

    // Rates
    const defaultRates = [
      { type: 'ps5', pricePerHour: 100 },
      { type: 'gaming-pc', pricePerHour: 100 },
      { type: 'racing-sim', pricePerHour: 100 }
    ];
    await Rate.insertMany(defaultRates);
    console.log('Seeded rates: PS5=₹100/hr, Gaming PC=₹100/hr, Racing Sim=₹100/hr');

    // Devices: 5 PS5s, 2 Gaming PCs (one doubles as Racing Sim)
    const devices = [];
    for (let i = 1; i <= 5; i += 1) {
      devices.push({ type: 'ps5', name: `PS5 Console ${i}`, stationNumber: 100 + i });
    }
    devices.push({ type: 'gaming-pc', name: 'Gaming PC 1', stationNumber: 1 });
    devices.push({ type: 'racing-sim', name: 'Gaming PC 2 / Racing Simulator', stationNumber: 2, notes: 'Dual-use: Gaming PC & Racing Simulator' });
    await Device.insertMany(devices);
    console.log('Seeded devices: 5 PS5, 1 Gaming PC, 1 Racing Simulator (dual-use)');
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    console.log('Mongo disconnected');
  }
};

run();

