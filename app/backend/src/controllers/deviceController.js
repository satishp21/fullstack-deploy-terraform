import Device from '../models/Device.js';

export const getDevicesSummary = async (req, res) => {
  try {
    const devices = await Device.find({ isActive: true });
    const summary = devices.reduce(
      (acc, d) => {
        if (d.type === 'gaming-pc') acc.gamingPc += 1;
        if (d.type === 'racing-sim') acc.racingSim += 1;
        if (d.type === 'ps5') acc.ps5 += 1;
        return acc;
      },
      { gamingPc: 0, racingSim: 0, ps5: 0 }
    );
    res.json({ devices, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const createDevice = async (req, res) => {
  try {
    const device = await Device.create(req.body);
    res.status(201).json(device);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

export const updateDevice = async (req, res) => {
  try {
    const device = await Device.findByIdAndUpdate(req.params.id, req.body, {
      new: true
    });
    res.json(device);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};


