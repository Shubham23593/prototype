import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Review, SourceStatus, ThermalEvent } from '../../lib/types';

const detectionSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } },
  acquiredAt: { type: Date, index: true }, mode: { type: String, index: true }, observation: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
detectionSchema.index({ location: '2dsphere' });
const reviewSchema = new mongoose.Schema({ eventId: { type: String, required: true, unique: true }, state: String, note: String, updatedAt: String, observation: mongoose.Schema.Types.Mixed });
const Detection = mongoose.models.Detection || mongoose.model('Detection', detectionSchema);
const ReviewModel = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export class Store {
  reviews = new Map<string, Review>();
  snapshots = new Map<string, ThermalEvent>();
  status: SourceStatus = { id: 'storage', name: 'Observation storage', status: 'local', detail: 'Local JSON journal. MongoDB is not configured; this is not an in-memory MongoDB imitation.', url: 'https://www.mongodb.com/docs/manual/geospatial-queries/' };
  private journal: string;
  constructor(directory = path.resolve('.runtime')) { this.journal = path.join(directory, 'reviews.json'); }
  private writes: Promise<void> = Promise.resolve();
  private mongo = false;

  async initialize() {
    try {
      const saved = JSON.parse(await fs.readFile(this.journal, 'utf8'));
      this.reviews = new Map(Object.entries(saved.schema === 2 ? saved.reviews : saved));
      this.snapshots = new Map(Object.entries(saved.schema === 2 ? saved.observations : {}));
    } catch { /* Valid on a clean first run. */ }
    if (!process.env.MONGODB_URI) return;
    this.status.lastAttempt = new Date().toISOString();
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 });
      await Promise.all([Detection.init(), ReviewModel.init()]);
      const reviews = await ReviewModel.find().lean();
      for (const item of reviews) { this.reviews.set(String(item.eventId), { state: item.state as Review['state'], note: String(item.note || ''), updatedAt: String(item.updatedAt) }); if (item.observation) this.snapshots.set(String(item.eventId), item.observation as ThermalEvent); }
      this.mongo = true;
      this.status = { ...this.status, status: 'connected', name: 'MongoDB', lastSuccess: new Date().toISOString(), detail: 'MongoDB connected. Unique observation IDs and a 2dsphere geospatial index are initialized.' };
    } catch {
      this.status = { ...this.status, status: 'degraded', detail: 'Configured MongoDB could not be reached. Reviews use the explicitly labelled local JSON journal; database persistence is not available.' };
    }
  }

  getReview(id: string) { return this.reviews.get(id) || null; }

  async setReview(id: string, state: 'watching' | 'reviewed' | 'clear', note = '', event?: ThermalEvent) {
    if (state === 'clear') { this.reviews.delete(id); this.snapshots.delete(id); }
    else { this.reviews.set(id, { state, note, updatedAt: new Date().toISOString() }); if (event) this.snapshots.set(id, {...event, review: null}); }
    const snapshot = JSON.stringify({schema: 2, reviews: Object.fromEntries(this.reviews), observations: Object.fromEntries(this.snapshots)});
    this.writes = this.writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.journal), { recursive: true });
      const tmp = this.journal + '.tmp';
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, this.journal);
    });
    await this.writes;
    if (this.mongo) {
      try {
        if (state === 'clear') await ReviewModel.deleteOne({ eventId: id });
        else await ReviewModel.updateOne({ eventId: id }, { $set: {...this.reviews.get(id), observation: this.snapshots.get(id)} }, { upsert: true });
      } catch {
        this.status = { ...this.status, status: 'degraded', detail: 'MongoDB write failed. This review was saved to the local JSON journal instead.' };
      }
    }
    return this.getReview(id);
  }

  async persistObservations(events: ThermalEvent[]) {
    if (!this.mongo || !events.length) return;
    try {
      for (let start = 0; start < events.length; start += 1000) {
        const chunk = events.slice(start, start + 1000);
        await Detection.bulkWrite(chunk.map(event => ({ updateOne: { filter: { eventId: event.id },
          update: { $set: { location: { type: 'Point', coordinates: [event.longitude, event.latitude] }, acquiredAt: new Date(event.acquiredAt), mode: event.mode, observation: event } }, upsert: true } })), { ordered: false });
      }
    } catch {
      this.status = { ...this.status, status: 'degraded', detail: 'MongoDB observation persistence failed. The source archive/cache remains available; review changes use the local journal.' };
    }
  }
}
