/* 
   Copyright 2020 Google LLC

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   https://www.apache.org/licenses/LICENSE-2.0
 
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import { AdsMetadata } from './ads_metadata'
import { VideoMetadata } from './video_metadata'
import { environment } from 'environments/environment';

export class Video {

    constructor(
        public id : string,
        public ads_metadata : AdsMetadata,
        public video_metadata : VideoMetadata,
        public status : string,
        public generated_video : string = '',
        public cloud_preview: boolean = false
        ) {}
        
        public static from_video_array(video_array: Array<any>): Video {
            let generated_video: string = '';
            let cloud_preview = false;
        
            if (video_array && video_array[4]) {
                generated_video = video_array[4];
        
                // Check if it's a Google Cloud Storage video
                if (generated_video.includes(environment.gsutil_uri_prefix)) {
                    cloud_preview = true;
                    generated_video = generated_video.replace(
                        environment.gsutil_uri_prefix, environment.gcs_url_prefix
                    );
                }
                // Check if it's a YouTube video
                else if (generated_video.includes('youtube.com') || generated_video.includes('youtu.be')) {
                    // Keep the YouTube URL as it is
                    generated_video = generated_video;
                }
                // Otherwise, assume it's a Google Drive video
                else {
                    generated_video = 'https://drive.google.com/file/d/' + generated_video + '/preview';
                }
            }
        
            return new Video(
                video_array[0],
                AdsMetadata.from_string_object(video_array[1]),
                VideoMetadata.from_string_object(video_array[2]),
                video_array[3],
                generated_video,
                cloud_preview
            );
        }
        
            
        public static to_video_array(video: Video): Array<any> {
            let generated_video = video.generated_video;
        
            if (video.cloud_preview) {
                generated_video = generated_video.replace(
                    environment.gcs_url_prefix, environment.gsutil_uri_prefix
                );
            } else if (generated_video.includes('drive.google.com')) {
                // For Google Drive videos, split based on the prefix to get the file ID
                generated_video = generated_video.split('/d/')[1].split('/preview')[0];
            }
        
            return [
                video.id,
                AdsMetadata.to_string_object(video.ads_metadata),
                VideoMetadata.to_string_object(video.video_metadata),
                video.status,
                generated_video
            ];
        }
        
}