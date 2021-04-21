import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, NgZone } from '@angular/core';
import { Component } from '@angular/core';
import Peer from 'peerjs';
import { Participant, VotesPerItem } from './domain/domain';
import { ParticipantStoreService } from './participant-store.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  public state: string = 'initial';
  //public peer: Peer|undefined;
  public peerId: string|undefined;

  public formData = {
    meetingID: this.getSettingValue('distEstMeetingID', '')
  }

  private itemNumber: number = 0;

  getSettingValue(key: string, defaultValue: string): string {
    let paramValue = new URL(location.href).searchParams.get(key);
    if (paramValue) {
      return paramValue;
    }
    let storedValue = localStorage.getItem(key);
    if (storedValue) {
      return storedValue;
    }
    return defaultValue;
  }

  constructor(
    public fieldService: ParticipantStoreService,
    private cdr: ChangeDetectorRef,
    private ngz: NgZone,
    private http: HttpClient) {
  }

  public isVoter(): boolean {
    return typeof(this.formData.meetingID) === 'string' && this.formData.meetingID.startsWith('v-');    
  }

  public isAdmin(): boolean {
    return typeof(this.formData.meetingID) === 'string' && this.formData.meetingID.startsWith('a-');    
  }

  public initNew(): void {
    this.createPeer('admin', undefined);    
  }

  public joinAsVoter(): void {
    this.joinAs('voter');    
  }

  public joinAsAdmin(): void {
    this.joinAs('admin');    
  }

  private joinAs(targetState: string) {
    if (!this.formData.meetingID) {
      alert('Bitte Meeting-ID angeben');
    }
    let peerId = this.formData.meetingID.substring(2);
    this.createPeer(targetState, peerId);
  }

  private createPeer(targetState: string, idToJoin: string | undefined) {
    //var peer = new Peer(undefined, {host: 'localhost', port: 9000, key: 'peerjs', debug: 2});
    // this.peer = new Peer(undefined, 
    //   {
    //     config: {
    //       iceServers: [
    //         {urls: 'stun:stun.l.google.com:19302' },
    //         {urls: 'turn:v2202012136631136755.bestsrv.de', username: 'ideenmesse', credential: 'clarifying-behind-anchoring-storyboard'}
    //       ]
    //     }
    //   }
    // );
    // this.peer.on('error', (err: any) => {
    //     console.log(err);
    // });
    // (this.peer as any).once('open', (id: string) => {
    //     this.ngz.run(() => this.initParticipant(targetState, idToJoin));
    // });
    this.http.post('/init', {})
      .subscribe((result: any) => {
        this.peerId = result;
        this.initParticipant(targetState, idToJoin);
      })
  }

  private initParticipant(targetState: string, idToJoin: string | undefined) {
    let urlKey;
    if (idToJoin) {
      urlKey = idToJoin;
    } else {
      urlKey = this.peerId as string;
    }

    this.fieldService.init(new Participant(
      this.http, 
      urlKey,
      this.getOrGenerateName(),
      true,
      targetState === 'admin',
      () => this.ngz.run(() => this.cdr.markForCheck())));
    this.fieldService.participant.connectTo(urlKey);
    this.state = targetState;
  }

  private getOrGenerateName(): string {
    let paramValue = new URL(location.href).searchParams.get('user');
    if (paramValue) {
      return paramValue;
    }
    let name = window.localStorage.getItem('myUsername');
    if (!name) {
      name = Date.now().toString(36) + Math.round(Math.random() * 1000000).toString(36);
      window.localStorage.setItem('myUsername', name);
    }
    return name;
  }

  public get participant() {
    return this.fieldService.participant;
  }

  public getAdminLink(): string {
    return this.getLink('a-');    
  }

  public getVoterLink(): string {
    return this.getLink('v-');    
  }

  private getLink(prefix: string): string {
    if (!this.peerId) {
      return '';
    }
    return window.location.href.split('?')[0] + "?distEstMeetingID=" + prefix + this.peerId;
  }

  public reconnect() {
    let id = prompt('Ziel-Peer-ID', this.formData.meetingID);
    if (id) {
      this.fieldService.participant.connectTo(id);
    }  
  }

  public voteForTop() {
    let topVote = this.getRadioList('topVoteForm', 'topVote');
    let selection = topVote.value;
    if (!selection) {
      alert('Bitte wählen Sie einen Vorschlag aus!');
      return;
    }
    this.participant.voteForTop(selection);
  }

  public saveEstimate() {
    let type = this.getRadioList('estimationForm', 'estimationType');
    let selection = type.value;
    if (!selection) {
      alert('Bitte wählen Sie eine Einschätzung aus!');
      return;
    }
    let estimate = selection;
    if (selection == 'Geld') {
      let val = this.getSelectValue('estimationForm', 'moneyAmount');
      if (!val) {
        alert('Bitte wählen Sie einen Betrag aus!');
        return;
      }
      estimate += ',' + val;
    }
    if (selection == 'Zeit') {
      let val1 = this.getSelectValue('estimationForm', 'timeAmount');
      if (!val1) {
        alert('Bitte wählen Sie eine Dauer aus!');
        return;
      }
      let val2 = this.getSelectValue('estimationForm', 'personAmount');
      if (!val2) {
        alert('Bitte wählen Sie eine Anzahl Personen aus!');
        return;
      }
      estimate += ',' + val1 + ',' + val2;
    }
    this.participant.saveEstimate(estimate);
    this.getRadioList('estimationForm', 'estimationType')
      .forEach(item => (item as HTMLInputElement).checked = false);
    this.itemNumber++;
  }

  private getSelectValue(formName: string, selectName: string): string {
    let form = document.forms.namedItem(formName);
    let sel = form?.elements.namedItem(selectName) as HTMLSelectElement;
    return sel.value;
  }

  private getRadioList(formName: string, radioName: string) {
    let form = document.forms.namedItem(formName);
    return form?.elements.namedItem(radioName) as RadioNodeList;
  }

  public itemId(index: number, item: VotesPerItem) {
    return item.id;
  }

  public activateEstimationType(value: string) {
    let type = this.getRadioList('estimationForm', 'estimationType');
    type.value = value;
  }

  public getCurrentItemColor(): string {
    let idx = this.itemNumber % 3;
    switch (idx) {
      case 0:
        return "#c9efb9";
      case 1:
        return "#93ace1";
      case 2:
        return "#6678ad";
      default:
        return "white";
    }
  }

  public addNewItems(): void {
    let form = document.forms.namedItem('newItems');
    let sel = form?.elements.namedItem('itemInput') as HTMLTextAreaElement;
    let val = sel.value;
    if (!val) {
      return;
    }
    let items = val.replace("\r\n", "\n").split("\n\n");
    items.forEach(item => {
      let trimmed = item.trim();
      if (trimmed.length > 0) {
        this.participant.addItem(trimmed);
      }
    })
    sel.value = '';
  }

}
