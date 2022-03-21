import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, Renderer2, ViewChild, ViewEncapsulation } from '@angular/core';
import { QuestionCursor } from '@project-sunbird/sunbird-quml-player-v9';
import * as _ from 'lodash-es';
import 'videojs-contrib-quality-levels';
import videojshttpsourceselector from 'videojs-http-source-selector';
import { ViewerService } from '../../services/viewer.service';

@Component({
  selector: 'video-player',
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class VideoPlayerComponent implements AfterViewInit, OnDestroy {
  @Input() config: any;
  @Output() questionSetData = new EventEmitter();
  @Output() playerInstance = new EventEmitter();
  showBackwardButton = false;
  showForwardButton = false;
  showPlayButton = true;
  showPauseButton = false;
  showControls = true;
  currentPlayerState = 'none';
  private unlistenTargetMouseMove: () => void;
  private unlistenTargetTouchStart: () => void;
  @ViewChild('target', { static: true }) target: ElementRef;
  @ViewChild('controlDiv', { static: true }) controlDiv: ElementRef;
  player: any;
  totalSeekedLength = 0;
  previousTime = 0;
  currentTime = 0;
  seekStart = null;
  time = 10;
  startTime;
  totalSpentTime = 0;
  isAutoplayPrevented = false;
  setMetaDataConfig = false;
  totalDuration = 0;

  constructor(public viewerService: ViewerService, private renderer2: Renderer2,public questionCursor: QuestionCursor,private http: HttpClient,) { }

  ngAfterViewInit() {
    this.viewerService.getPlayerOptions().then(async (options) => {
      this.player = await videojs(this.target.nativeElement, {
        fluid: true,
        responsive: true,
        sources: options,
        autoplay: true,
        muted: _.get(this.config, 'muted'),
        playbackRates: [0.5, 1, 1.5, 2],
        controlBar: {
          children: ['playToggle', 'volumePanel', 'durationDisplay',
            'progressControl', 'remainingTimeDisplay',
            'playbackRateMenuButton', 'fullscreenToggle']
        },
        plugins: {
          httpSourceSelector:
          {
            default: 'low'
          }
        },
        html5: {
          hls: {
            overrideNative: true
          },
          nativeAudioTracks: false,
          nativeVideoTracks: false,
        }
      });
      this.player.videojshttpsourceselector = videojshttpsourceselector;
      this.player.videojshttpsourceselector();
      const markers = this.viewerService.getMarkers()

       if(markers && markers.length >0){
          const identifiers = markers.map( item => {
            return item.identifier;
          })
          this.viewerService.questionCursor.getAllQuestionSet(identifiers).subscribe(
            (response) => {
              this.viewerService.maxScore = response.reduce((a,b) => a+b,0)
            }
          ) 
      }

      if (markers) {
        this.player.markers({
          markers,
          markerStyle: {
            'height': '7px',
            'bottom': '39%',
            'background-color': 'orange'
          },
          onMarkerReached: (marker) => {
            if(marker){
              const { time, text, identifier, duration } = marker;
              if (!(this.player.currentTime() > (time + duration))) {
                setTimeout(() => {
                    this.pause()
                    this.player.controls(false);  
                }, 1000);
                this.viewerService.getQuestionSet(identifier).subscribe(
                  (response) => {
                    this.questionSetData.emit({response, time, identifier});
                  }, (error) => {
                    this.play()
                    this.player.controls(true);
                    console.log(error); 
                  }
                );
              }
            }
          }
        });
        this.playerInstance.emit(this.player);
        this.viewerService.playerInstance = this.player;
        this.viewerService.preFetchContent();
      }
      this.registerEvents();
    });

    setInterval(() => {
      if (!this.isAutoplayPrevented && this.currentPlayerState !== 'pause') {
        this.showControls = false;
      }
    }, 5000);

    this.unlistenTargetMouseMove = this.renderer2.listen(this.target.nativeElement, 'mousemove', () => {
      this.showControls = true;
    });
    this.unlistenTargetTouchStart = this.renderer2.listen(this.target.nativeElement, 'touchstart', () => {
      this.showControls = true;
    });

    this.viewerService.sidebarMenuEvent.subscribe(event => {
      if (event === 'OPEN_MENU') { this.pause(); }
      if (event === 'CLOSE_MENU') { this.play(); }
    });
  }

  onLoadMetadata(e) {
    this.totalDuration = this.viewerService.metaData.totalDuration = this.player.duration();
  }

  registerEvents() {
    const promise = this.player.play();
    if (promise !== undefined) {
      promise.catch(error => {
        this.isAutoplayPrevented = true;
      });
    }

    const events = ['loadstart', 'play', 'pause', 'durationchange',
      'error', 'playing', 'progress', 'seeked', 'seeking', 'volumechange',
      'ratechange'];

    this.player.on('fullscreenchange', (data) => {
      // This code is to show the controldiv in fullscreen mode
      if (this.player.isFullscreen()) {
        this.target.nativeElement.parentNode.appendChild(this.controlDiv.nativeElement);
      }
      this.viewerService.raiseHeartBeatEvent('FULLSCREEN');
    })

    this.player.on('pause', (data) => {
      this.pause();
    });

    this.player.on('ratechange', (data) => {
      this.viewerService.metaData.playBackSpeeds.push(this.player.playbackRate());
    });

    this.player.on('volumechange', (data) => {
      this.viewerService.metaData.volume.push(this.player.volume());
      this.viewerService.metaData.muted = this.player.muted();
    });

    this.player.on('ended',(data) => {
      this.viewerService.metaData.currentDuration = 0;
      this.handleVideoControls({ type: 'ended' });
      this.viewerService.playerEvent.emit({ type: 'ended' });
    });

    this.player.on('play', (data) => {
      this.currentPlayerState = 'play';
      this.showPauseButton = true;
      this.showPlayButton = false;
      this.viewerService.raiseHeartBeatEvent('PLAY');
      this.isAutoplayPrevented = false;
    });

    this.player.on('timeupdate', (event) => {
      this.viewerService.metaData.currentDuration = this.player.currentTime();
      this.handleVideoControls(event);
      this.viewerService.playerEvent.emit(event);
      if (this.player.currentTime() >= this.player.duration()) {
        this.viewerService.metaData.currentDuration = 0;
      this.handleVideoControls({ type: 'ended' });
      this.viewerService.playerEvent.emit({ type: 'ended' });
    }
    });
    events.forEach(event => {
      this.player.on(event, (data) => {
        this.handleVideoControls(data);
        this.viewerService.playerEvent.emit(data);
      });
    });

  }

  toggleForwardRewindButton() {
    this.showForwardButton = true;
    this.showBackwardButton = true;
    if ((this.player.currentTime() + this.time) > this.totalDuration) {
      this.showForwardButton = false;
    }
    if ((this.player.currentTime() - this.time) < 0) {
      this.showBackwardButton = false;
    }
  }

  play() {
    this.player.play();
    this.currentPlayerState = 'play';
    this.showPauseButton = true;
    this.showPlayButton = false;
    this.toggleForwardRewindButton();
  }

  pause() {
    this.player.pause();
    this.currentPlayerState = 'pause';
    this.showPauseButton = false;
    this.showPlayButton = true;
    this.toggleForwardRewindButton();
    this.viewerService.raiseHeartBeatEvent('PAUSE');
  }

  backward() {
    this.player.currentTime(this.player.currentTime() - this.time);
    this.toggleForwardRewindButton();
    this.viewerService.raiseHeartBeatEvent('BACKWARD');
  }

  forward() {
    this.player.currentTime(this.player.currentTime() + this.time);
    this.toggleForwardRewindButton();
    this.viewerService.raiseHeartBeatEvent('FORWARD');
  }

  handleVideoControls({ type }) {
    if (type === 'playing') {
      this.showPlayButton = false;
      this.showPauseButton = true;
      if (this.setMetaDataConfig) {
        this.setMetaDataConfig = false;
        this.setPreMetaDataConfig();
      }
    }
    if (type === 'ended') {
      this.totalSpentTime += new Date().getTime() - this.startTime;
      this.viewerService.visitedLength = this.totalSpentTime;
      this.viewerService.currentlength = this.player.currentTime();
      this.viewerService.totalLength = this.totalDuration;
      this.updatePlayerEventsMetadata({ type });
    }
    if (type === 'pause') {
      this.totalSpentTime += new Date().getTime() - this.startTime;
      this.updatePlayerEventsMetadata({ type });
    }
    if (type === 'play') {
      this.startTime = new Date().getTime();
      this.updatePlayerEventsMetadata({ type });
    }

    if (type === 'loadstart') {
      this.startTime = new Date().getTime();
      this.setMetaDataConfig = true;
    }

    // Calculating total seeked length
    if (type === 'timeupdate') {
      this.previousTime = this.currentTime;
      this.currentTime = this.player.currentTime();
      this.toggleForwardRewindButton();
    }
    if (type === 'seeking') {
      if (this.seekStart === null) { this.seekStart = this.previousTime; }
    }
    if (type === 'seeked') {
      this.updatePlayerEventsMetadata({ type });
      if (this.currentTime > this.seekStart) {
        this.totalSeekedLength = this.totalSeekedLength + (this.currentTime - this.seekStart);
      } else if (this.seekStart > this.currentTime) {
        this.totalSeekedLength = this.totalSeekedLength + (this.seekStart - this.currentTime);
      }
      this.viewerService.totalSeekedLength = this.totalSeekedLength;
      this.seekStart = null;
      if(this.player.markers && this.player.markers.getMarkers) {
        const markers = this.player.markers.getMarkers()
        markers.forEach(marker => {
          if(!this.viewerService.interceptionResponses[marker.time] && marker.time < this.currentTime) {
            this.viewerService.interceptionResponses[marker.time] = {
              score: 0,
              isSkipped: false
            }
            document.querySelector(`[data-marker-time="${marker.time}"]`)['style'].backgroundColor = "red";
          }
        });
      }
    }
  }

  setPreMetaDataConfig() {
    if(!_.isEmpty(_.get(this.config, 'volume'))) {
      this.player.volume(_.last(_.get(this.config, 'volume')));
    }
    if(_.get(this.config, 'currentDuration')) {
      this.player.currentTime(_.get(this.config, 'currentDuration'));
    }
    if(!_.isEmpty(_.get(this.config, 'playBackSpeeds'))) {
      this.player.playbackRate(_.last(_.get(this.config, 'playBackSpeeds')));
    }
  }

  updatePlayerEventsMetadata({ type }) {
    const action = {};
    action[type + ''] = this.player.currentTime();
    this.viewerService.metaData.actions.push(action);
  }

  ngOnDestroy() {
    if (this.player) {
      this.player.dispose();
    }
    this.unlistenTargetMouseMove();
    this.unlistenTargetTouchStart();
  }
}
