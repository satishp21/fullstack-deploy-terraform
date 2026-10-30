import Rate from '../models/Rate.js';

export const getRates = async (req, res) => {
  try {
    const rates = await Rate.find({});
    res.json(rates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const upsertRate = async (req, res) => {
  const { type, pricePerHour } = req.body;
  try {
    const rate = await Rate.findOneAndUpdate(
      { type },
      { pricePerHour },
      { new: true, upsert: true }
    );
    res.json(rate);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};


