//import { RTCDB } from 'rtcdb';

import { HttpClient } from "@angular/common/http";
import { timer } from "rxjs";

interface ItemDto {
  boldText: string;
  text: string;
}

interface DbDto {
  time: number,
  items: any,
  topVotes: any,
  estimates: any,
  state: {state: string}
}

class VotesPerItem {
  public topVoteCount: number = 0;
  public totalEstimateCount: number = 0;
  public finishedEstimateCount: number = 0;
  private estimateMultiset: Map<string, number> = new Map();

  constructor(
    public readonly id: string,
    public readonly boldText: string, 
    public readonly text: string) {

  }

  public countEstimate(estimate: string): void {
    this.totalEstimateCount++;
    if (estimate !== 'pending') {
      this.finishedEstimateCount++;
      if (this.estimateMultiset.has(estimate)) {
        this.estimateMultiset.set(estimate, this.estimateMultiset.get(estimate) as number + 1);
      } else {
        this.estimateMultiset.set(estimate, 1);
      }
    }
}

  public get pendingEstimateCount(): number {
    return this.totalEstimateCount - this.finishedEstimateCount;
  }

  public get allEstimates(): string {
    let keys = Array.from(this.estimateMultiset.keys());
    keys.sort((a, b) => this.toNumber(a) - this.toNumber(b));
    return keys.map(k => this.estimateMultiset.get(k) + 'x' + k).join('; ');
  }

  public get medianEstimate(): string {
    let keys = Array.from(this.estimateMultiset.keys());
    if (keys.length == 0) {
      return '';
    }
    keys.sort((a, b) => this.toNumber(a) - this.toNumber(b));
    let expanded: string[] = [];
    keys.forEach(k => {
      if (this.shallCount(k)) {
        let cnt = this.estimateMultiset.get(k) as number;
        for (let i = 0; i < cnt; i++) {
          expanded.push(k);
        }
      }
    });
    if (expanded.length == 0) {
      return '';
    }
    return expanded[Math.floor(expanded.length / 2)];
  }

  public get averageEstimate(): number {
    let sum = 0;
    let count = 0;
    this.estimateMultiset.forEach((value, key) => {
      if (this.shallCount(key)) {
        sum += value * this.toNumber(key);
        count += value;
      }
    });
    return count == 0 ? 0 : sum / count;
  }

  public get relativeStandardDeviation(): number {
    let avg = this.averageEstimate;
    if (avg == 0) {
      return 0;
    }
    let sum = 0;
    let count = 0;
    this.estimateMultiset.forEach((value, key) => {
      if (this.shallCount(key)) {
        let diff = this.toNumber(key) - avg;
        sum += value * diff * diff;
        count += value;
      }
    });
    let stdDev = Math.sqrt(sum / count);
    return stdDev * 100 / avg;
  }

  private toNumber(estimate: string): number {
    let parts = estimate.split(',');
    if (parts.length <= 1) {
      return 0;
    }
    let product;
    if (parts[0] == 'Geld') {
      product = 1;
    } else if (parts[0] == 'Zeit') {
      product = 50;
    } else {
      product = 0;
    }
    for (let i = 1; i < parts.length; i++) {
      product *= Number.parseFloat(parts[i]);
    }
    return product;
  }

  private shallCount(estimate: string): boolean {
    return estimate != 'pending' && estimate != 'unknown';
  }
}

class VoteSummary {
  private items: Map<string, VotesPerItem> = new Map();

  constructor(db: Db) {
    db.forEach('items', (id, dta) => {
      let sid = id as string;      
      this.items.set(sid, new VotesPerItem(sid, dta.boldText, dta.text));
    });
    db.forEach('topVotes', (id, dta) => {
      let itemVotes = this.items.get(dta);
      if (itemVotes) {
        itemVotes.topVoteCount++;
      }
    });
    db.forEach('estimates', (id, dta) => {
      let parts = (id as string).split('_for_');
      let itemVotes = this.items.get(parts[1]);
      if (itemVotes) {
        itemVotes.countEstimate(dta);
      }
    });
  }

  public get sortedItems(): VotesPerItem[] {
    let list: VotesPerItem[] = [];
    this.items.forEach((value, key) => list.push(value));
    list.sort((a, b) => {
      let diff = b.topVoteCount - a.topVoteCount;
      if (diff != 0) {
        return diff;
      }
      diff = b.averageEstimate - a.averageEstimate;
      if (diff != 0) {
        return diff;
      }
      return a.totalEstimateCount - b.totalEstimateCount;
    });
    return list;
  }

  public get stableItems(): VotesPerItem[] {
    let list: VotesPerItem[] = [];
    this.items.forEach((value, key) => list.push(value));
    list.sort((a, b) => a.id.localeCompare(b.id));
    return list;
  }

  public get maxFinishedEstimateCount(): number {
    let max = 0;
    this.items.forEach((value, key) => max = Math.max(max, value.finishedEstimateCount));
    return max;
  }

  public get minFinishedEstimateCount(): number {
    let min = Number.POSITIVE_INFINITY;
    this.items.forEach((value, key) => min = Math.min(min, value.finishedEstimateCount));
    return min;
  }

  public get topVoteCount(): number {
    let sum = 0;
    this.items.forEach((value, key) => sum += value.topVoteCount);
    return sum;
  }
}
  
class Participant {
  public readonly name: string;
  private readonly db: Db;
  public readonly markCallback;

  private currentItemId: string|undefined;

  private addedItemCount: number = 0;

  constructor(http: HttpClient, urlKey: string, ownName: string, clean: boolean, admin: boolean, markCallback: Function) {
    this.name = ownName;
    this.markCallback = markCallback;
    this.db = new Db(http, urlKey);
    // this.db = new RTCDB('distEst.' + ownName, peer, clean);
    // this.db.on(['add', 'update'], 'items', false, () => this.invalidateCache());
    // this.db.on(['add', 'update'], 'topVotes', false, () => this.invalidateCache());
    // this.db.on(['add', 'update'], 'estimates', false, () => this.invalidateCache());

    if (clean && admin) {
      this.db.put('state', 'state', 'running');
    }
  }

  public addItem(trimmed: string): void {
    let obj : ItemDto;
    let colonIndex = trimmed.indexOf(':');
    if (colonIndex >= 0) {
      obj = {
        boldText: trimmed.substring(0, colonIndex + 1),
        text: trimmed.substring(colonIndex + 1)
      };
    } else {
      obj = {
        boldText: '',
        text: trimmed
      };
    }
    let key;
    do {
      key = this.name + this.addedItemCount;
      this.addedItemCount++;
    } while (this.db.get('items', key))
    this.db.put('items', key, obj);
  }

  public getState(): string {
    return this.db.get('state', 'state');
  }

  public setState(state: string): void {
    return this.db.put('state', 'state', state);
  }

  public connectTo(idToJoin: string): void {
    this.db.setUrlKey(idToJoin);
  }

  public hasNoTopVote(): boolean {
    return typeof(this.db.get('topVotes', this.name)) !== 'string';
  }

  public hasFurtherItems(): boolean {
    return !!this.getCurrentItemId();
  }

  public getCurrentItemId(): string | undefined {
    if (!this.currentItemId) {
      this.determineNextItem();
    }
    return this.currentItemId;
  }

  public getCurrentItemText(): string {
    let text = this.getCurrentItemData()?.text;
    return text ? text : '';
  }

  public getCurrentItemBoldText(): string {
    let text = this.getCurrentItemData()?.boldText;
    return text ? text : '';
  }

  private getCurrentItemData() {
    let id = this.getCurrentItemId();
    if (!id) {
      return undefined;
    }
    return this.db.get('items', id);
  }

  private determineNextItem() {
    if (this.getState() === 'ended' || this.hasNoTopVote()) {
      console.log('ended');
      this.currentItemId = undefined;
      return;
    }
    let summary = this.voteSummary;
    let notYetEstimated: VotesPerItem[] = [];
    summary.stableItems.forEach(item => {
      if (this.hasNotYetEstimated(item.id)) {
        notYetEstimated.push(item);
      }
    });
    if (notYetEstimated.length == 0) {
      console.log('no more items');
      this.currentItemId = undefined;
      return;
    }
    if (notYetEstimated.length == 1) {
      console.log('onyl one left');
      this.startEstimating(notYetEstimated[0].id);
      return;
    }
    console.log('not yet estimatd ' + notYetEstimated.map(x => x.id));
    let c1 = this.pickRandom(notYetEstimated);
    let c2 = this.pickRandom(notYetEstimated);
    console.log('c1=' + c1.id);
    console.log('c2=' + c2.id);
    if (c1.finishedEstimateCount < c2.finishedEstimateCount
      || (c1.finishedEstimateCount == c2.finishedEstimateCount && c1.totalEstimateCount < c2.totalEstimateCount)) {
      console.log('pick one ' + c2.totalEstimateCount);
      this.startEstimating(c1.id);
    } else {
      console.log('pick other' + c1.totalEstimateCount);
      this.startEstimating(c2.id);
    }
  }

  private hasNotYetEstimated(itemId: string): boolean {
    let estimate = this.db.get('estimates', this.estimateKey(itemId));
    console.log('estimate for ' + itemId + '=' + estimate);
    return typeof(estimate) !== 'string' || estimate === 'pending';
  }

  private pickRandom(list: VotesPerItem[]): VotesPerItem {
    let rnd = Math.random();
    return list[Math.floor(rnd * list.length)];
  }

  private startEstimating(itemId: string) {
    this.currentItemId = itemId;
    this.setEstimateRaw(this.currentItemId, 'pending');
  }

  public saveEstimate(estimate: string) {
    if (!this.currentItemId) {
      return;
    }
    this.setEstimateRaw(this.currentItemId, estimate);
    this.currentItemId = undefined;
  }

  private setEstimateRaw(itemId: string, estimate: string) {
    this.db.put('estimates', this.estimateKey(itemId), estimate);
  }

  private estimateKey(itemId: string) {
    return this.name + '_for_' + itemId;
  }

  public get voteSummary(): VoteSummary {
    return new VoteSummary(this.db);
  }

  voteForTop(itemId: string) {
    this.startEstimating(itemId);
    this.db.put('topVotes', this.name, itemId);
  }
}

function curTime(): string {
  return new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});
}

class Db {
  private dbCache: DbDto = {
    time: 0,
    items: {},
    estimates: {},
    topVotes: {},
    state: {state: 'running'}
  };
  private getRunning: boolean = false;
  private putRunning: boolean = false;
  private putQueue: any[] = [];
  private lastGet: number = 0;

  constructor(
    private http: HttpClient,
    private urlKey: string
  ) {
    window.setInterval(() => {
      this.triggerGet();
    }, 2000);
  }
  
  setUrlKey(uk: string) {
    this.urlKey = uk;
  }

  public put(db: string, key: string, value: any) {
    let dca = this.dbCache as any;
    if (!dca[db]) {
      dca[db] = {}
    }
    dca[db][key] = value;
    console.log('put ' + db + ' ' + key + ' ' + value);
    let data = {
      urlKey: this.urlKey,
      db: db,
      key: key,
      value: value
    };
    this.putQueue.push(data);
    this.putFromQueue();
  }

  private putFromQueue() {
    if (this.putRunning) {
      return;
    }
    if (this.putQueue.length == 0) {
      return;
    }
    this.putRunning = true;
    let data = this.putQueue.shift();
    this.http.post('/putValue', data).subscribe((data: any) => {
      this.updateIfNewer(data);
      this.putRunning = false;
      this.putFromQueue();
    },
    (error: any) => {
      this.putRunning = false;
      this.putFromQueue();
      console.log('error ' + error);
    });
  }

  private updateIfNewer(data: any) {
    if (data.time > this.dbCache.time) {
      this.dbCache = data;
    }
  }
  
  public get(db: string, key: string) {
    this.triggerGet();
    let dbObj = (this.dbCache as any)[db];
    if (!dbObj) {
      return undefined;
    }
    return dbObj[key];
  }
  
  public forEach(db: string, f: (key: string, value: any) => void) {
    this.triggerGet();
    let obj : any = (this.dbCache as any)[db];
    if (!obj) {
      return;
    }
    Object.keys(obj).forEach(id => f(id, obj[id]));
  }  

  private triggerGet() {
    if (this.getRunning || this.putRunning) {
      return;
    }
    let now = new Date().getTime();
    if (now - this.lastGet < 1000) {
      return;
    }
    this.lastGet = now;
    this.getRunning = true;
    this.http.post('/getDb', {
      urlKey: this.urlKey
    }).subscribe((data: any) => {
      this.getRunning = false;
      if (!this.putRunning && this.putQueue.length == 0) {
        this.updateIfNewer(data);
      }
    },
    (error: any) => {
      this.getRunning = false;
      console.log('error ' + error);
    });
  }
}



export { Participant, VotesPerItem };
