var SPREADSHEET_URL = 'INSERT SPREADSHEET URL HERE';
var SHEET_NAME = 'Campaigns';
//var SLEEP_TIME_SECONDS = 60;
var ACCOUNTS_LIMIT = 50;

function isRowEmpty(sheet, rowNum) {
  var rowData = sheet.getRange(rowNum, 1, 1, FIELDS.length).getValues()[0];
  return rowData.every(function (cell) {
    return cell === '';
  });
}

function main() {
  Logger.log('Starting main function');
  AdsManagerApp.accounts()
    .withLimit(ACCOUNTS_LIMIT)
    .executeInParallel('processAccount', null);
  Logger.log('Executed accounts in parallel');
}

function isAccountAccessible(accountId) {
  Logger.log('Checking access for account ID: ' + accountId);

  try {
    var accountSelector = AdsManagerApp.accounts().get();

    while (accountSelector.hasNext()) {
      var account = accountSelector.next();
      if (account.getCustomerId() == accountId) {
        Logger.log('Access granted for account ID: ' + accountId);
        return true;
      }
    }

    Logger.log('Access denied for account ID: ' + accountId);
    return false;
  } catch (e) {
    Logger.log('Error checking access for account ID: ' + accountId + '. Error: ' + e.message);
    return false;
  }
}

function processAccount() {
  Logger.log('Starting processAccount function');

  var sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL).getSheetByName(SHEET_NAME);
  var accountIds = Util.findAccountIds(sheet);
  Logger.log('Found ' + accountIds.length + ' account IDs');

  for (var row = 0; row < accountIds.length; row++) {
    var accountId = accountIds[row] != '' ? JSON.parse(accountIds[row])['account_id'] : '';
    Logger.log('Processing row: ' + (row + 2) + ', Account ID: ' + accountId);

    if (isRowEmpty(sheet, row + 2)) {
      Logger.log('Empty row at row ' + (row + 2) + '. Stopping further processing.');
      break;
    }

    if (!accountId || accountId === '') {
      Logger.log('Skipping empty or invalid accountId at row ' + (row + 2));
      continue;
    }

    if (!isAccountAccessible(accountId)) {
      Logger.log('Account ID ' + accountId + ' not accessible at row ' + (row + 2));
      continue;
    }

    Logger.log('Account ID exists and is accessible: ' + accountId + ' at row ' + (row + 2));

    try {
      // Log the context switch to the target account
      Logger.log('Attempting to switch to account ID: ' + accountId);
      AdsManagerApp.select(AdsManagerApp.accounts().withIds([accountId]).get().next());
      Logger.log('Switched to account ID: ' + accountId);

      processRow(new Row(row + 2, sheet));
      Logger.log('Successfully processed row ' + (row + 2) + ' for account ID: ' + accountId);
    } catch (e) {
      Logger.log('Error processing row ' + (row + 2) + ' for account ID: ' + accountId + '. Error: ' + e.message + ' Stack: ' + e.stack);
    }
  }

  SpreadsheetApp.flush();
  Logger.log('Finished processing all rows.');
}


function logAllVideoCampaigns() {
  Logger.log('Logging all video campaigns in the account...');
  var videoCampaigns = AdsApp.videoCampaigns().get();
  if (videoCampaigns.totalNumEntities() === 0) {
    Logger.log('No video campaigns found in the account.');
  } else {
    while (videoCampaigns.hasNext()) {
      var campaign = videoCampaigns.next();
      Logger.log('Video Campaign found: ' + campaign.getName());
    }
  }
}

function processRow(row) {
  try {
    var status = row.get('Status');
    var handler = STATUS_HANDLERS[status];

    if (!handler) {
      Logger.log('No handler for status: ' + status + ' at row ' + row.row);
      return;
    }

    Logger.log('Handling status: ' + status + ' for row ' + row.row);
    handler(row);

    row.save();
    Logger.log('Row ' + row.row + ' saved.');
  } catch (e) {
    Logger.log('Error in processRow for row ' + row.row + ': ' + e.message + ' Stack: ' + e.stack);
  }
}


function Row(row, sheet) {
  var rowRange = sheet.getRange(row, 1, 1, FIELDS.length);
  var rowData = rowRange.getValues()[0];
  var data = {};

  FIELDS.forEach(function (field, index) {
    data[field] = rowData[index];
  });

  this.row = row.toFixed(0);

  this.get = function (field) {
    return data[field];
  };

  this.set = function (field, value) {
    data[field] = value;
    rowData[FIELDS.indexOf(field)] = value;
  };

  this.save = function () {
    rowRange.setValues([rowData]);
    Logger.log('Row ' + this.row + ' data saved to sheet.');
  };
}

var FIELDS = ['ID', 'AdsMetadata', 'VideoMetadata', 'Status', 'GeneratedVideo'];

var STATUS_HANDLERS = {
  'Off': function (row) {
    Logger.log('Handling "Off" status for row ' + row.row);
    const adsMetadata = JSON.parse(row.get('AdsMetadata'));

    Util.pauseAllVideoAds(adsMetadata['ad_group_name'], adsMetadata['campaign_name']);

    adsMetadata['ad_name'] = '';
    adsMetadata['ad_group_name'] = '';

    row.set('GeneratedVideo', '');
    row.set('Status', 'Done');
    row.set('AdsMetadata', JSON.stringify(adsMetadata));
  },

  'Video Ready': function (row) {
    Logger.log('Handling "Video Ready" status for row ' + row.row);

    const adsMetadata = JSON.parse(row.get('AdsMetadata'));
    const videoMetadata = JSON.parse(row.get('VideoMetadata'));

    var adGroupName = adsMetadata['ad_group_name'] || videoMetadata['base_video'] + '-' + String(row.get('GeneratedVideo')).replace(/,/g, '-');

    // Add targets related to Campaign
    add_campaign_targets(adsMetadata['campaign_name'], adsMetadata['target_location']);

    // Create or retrieve adGroup
    var adGroup = Util.findVideoAdGroup(adGroupName, adsMetadata['campaign_name']);

    if (!adGroup) {
      Logger.log('Ad group not found, creating new ad group: ' + adGroupName);
      adGroup = Util.createOrRetrieveVideoAdGroup(adsMetadata['campaign_name'], adsMetadata['ad_group_type'], adGroupName);
    }

    if (!adGroup) {
      Logger.log('Failed to create or retrieve adGroup for campaign: ' + adsMetadata['campaign_name']);
      return;
    }

    adsMetadata['ad_group_name'] = adGroupName;
    Logger.log('Ad group created or retrieved: ' + adGroup.getName());

    // Handle targeting based on ad group type
    var targeting = adGroup.getAdGroupType().includes("VIDEO") ? adGroup.videoTargeting() : adGroup.targeting();

    // Log all existing audiences in the ad group
    var existingAudiences = targeting.audiences().get();
    while (existingAudiences.hasNext()) {
      var audience = existingAudiences.next();
      Logger.log('Existing audience: ' + audience.getName());
    }

    // Associate audience with the adGroup
    try {
      Logger.log('Attempting to associate audience: ' + adsMetadata['audience_name']);
      Util.associateAudienceWithAdGroup(adGroup, adsMetadata['audience_name'], Util.videoAdAudienceAssociator);
    } catch (e) {
      Logger.log('Error associating audience: ' + e.message);
    }

    // Create video ad
    var adName = 'Ad ' + (adGroup.videoAds().get().totalNumEntities() + 1);
    var videoAd = Util.createOrReactivateVideoAd(adName, adGroup, row.get('GeneratedVideo'), adsMetadata['url'], adsMetadata['call_to_action']);
    Logger.log('Video Ready before error');

    if (videoAd) {
      Logger.log('Video ad created successfully.');

      if (videoAd.S && videoAd.S.Oa && videoAd.S.Oa.result) {
        var result = videoAd.S.Oa.result;

        if (typeof result.getName === 'function' && typeof result.getType === 'function') {
          var videoAdName = result.getName();
          var videoAdType = result.getType();
          Logger.log('videoAdName: ' + videoAdName + ' created with type: ' + videoAdType);
          adsMetadata['ad_name'] = videoAdName;
        } else {
          Logger.log('The result object does not have getName or getType functions.');
        }
      } else {
        Logger.log('Failed to find result in videoAd.S.Oa');
      }
    } else {
      Logger.log('Failed to create video ad for ad group: ' + adGroup.getName());
    }

    row.set('Status', 'Running');
    row.set('AdsMetadata', JSON.stringify(adsMetadata));
  },

  'Image Ready': function (row) {
    Logger.log('Handling "Image Ready" status for row ' + row.row);
    const adsMetadata = JSON.parse(row.get('AdsMetadata'));
    const videoMetadata = JSON.parse(row.get('VideoMetadata'));

    var adGroupName = videoMetadata['base_video'] + '-' + String(row.get('GeneratedVideo')).replace(/,/g, '-');

    add_campaign_targets(adsMetadata['campaign_name'], adsMetadata['target_location']);

    var adGroup = Util.createOrRetrieveAdGroup(adsMetadata['campaign_name'], adGroupName);
    adsMetadata['ad_group_name'] = adGroupName;

    Util.associateAudienceWithAdGroup(adGroup, adsMetadata['audience_name'], Util.adAudienceAssociator);

    var adName = 'Ad ' + (adGroup.ads().get().totalNumEntities() + 1);
    var ad = Util.createOrReactivateAd(adName, adGroup, row.get('GeneratedVideo'), adsMetadata['url']);

    if (ad != null) {
      Logger.log('Ad %s created', ad.getName());
      adsMetadata['ad_name'] = ad.getName();

      row.set('Status', 'Running');
      row.set('AdsMetadata', JSON.stringify(adsMetadata));
    }
  },

  'Price Changed': function (row) {
    Logger.log('Handling "Price Changed" status for row ' + row.row);

    const adsMetadata = JSON.parse(row.get('AdsMetadata'));

    Util.pauseAllVideoAds(adsMetadata['ad_group_name'], adsMetadata['campaign_name']);

    adsMetadata['ad_name'] = '';
    row.set('Status', 'Paused');
    row.set('AdsMetadata', JSON.stringify(adsMetadata));
  }
}

function add_campaign_targets(campaign_name, location_targets_string) {
  var campaign = Util.findVideoCampaign(campaign_name) || Util.findCampaign(campaign_name);


  if (campaign === undefined) {
    Logger.log('Campaign not found: ' + campaign_name);
    return;
  }
  //Util.logSupportedAdGroupTypes(campaign)  USE THIS FOR DEBUGING ONLY


  var location_targets = String(location_targets_string).split(';').filter(function (t) {
    return t;
  });

  Logger.log("Adding location targets: " + location_targets);

  var startTime = new Date().getTime();

  var active_locations = campaign.targeting().targetedLocations().get();

  while (active_locations.hasNext()) {
    active_locations.next().remove();
  }

  location_targets.forEach(function (locationId) {
    Logger.log('Adding location ID: ' + locationId);
    var parsedLocationId = parseInt(locationId, 10);
    if (parsedLocationId) {
      campaign.addLocation(parsedLocationId);
    } else {
      Logger.log('Invalid location ID: ' + locationId + '. Skipping this location.');
    }
  });

  var endTime = new Date().getTime();
  Logger.log('Time taken to add locations: ' + (endTime - startTime) + 'ms');
}

var Util = {

  findAccountIds: function (sheet) {
    return sheet.getRange('B2:B').getValues()
  },

  findVideoCampaign: function (campaign_name) {

    var campaign = AdsApp.videoCampaigns()
      .withCondition('CampaignName = "' + campaign_name + '"')
      .get()

    return campaign.hasNext() ? campaign.next() : undefined
  },

  findCampaign: function (campaign_name) {

    var campaign = AdsApp.campaigns()
      .withCondition('CampaignName = "' + campaign_name + '"')
      .get()

    return campaign.hasNext() ? campaign.next() : undefined
  },

  findVideoAdGroup: function (adGroupName, campaignName) {

    var videoAdGroup = AdsApp.videoAdGroups()
      .withCondition('CampaignName = "' + campaignName + '"')
      .withCondition('Name = "' + adGroupName + '"')
      .get()

    return videoAdGroup.hasNext() ? videoAdGroup.next() : undefined
  },

  findAdGroup: function (adGroupName, campaignName) {

    var displayAdGroup = AdsApp.adGroups()
      .withCondition('CampaignName = "' + campaignName + '"')
      .withCondition('Name = "' + adGroupName + '"')
      .get()

    return displayAdGroup.hasNext() ? displayAdGroup.next() : undefined
  },

  findVideoAd: function (adName, adGroup) {

    var videoAdsIterator = adGroup.videoAds().get()

    while (videoAdsIterator.hasNext()) {

      var existingVideoAd = videoAdsIterator.next()

      if (existingVideoAd.getName() == adName)
        return existingVideoAd
    }

    return undefined
  },

  findAd: function (adName, adGroup) {

    var adsIterator = adGroup.ads().get()

    while (adsIterator.hasNext()) {

      var existingAd = adsIterator.next()

      if (existingAd.getName() == adName)
        return existingAd
    }

    return undefined
  },

  pauseAllVideoAds: function (adGroupName, campaignName) {

    var videoAdGroup = this.findVideoAdGroup(adGroupName, campaignName)

    // This should not happen
    if (!videoAdGroup) {
      Logger.log('videoAdGroup %s not found for campaign %s', adGroupName, campaignName)
      return
    }

    var videoAdsIterator = videoAdGroup.videoAds()
      .withCondition("Status = ENABLED")
      .get()

    while (videoAdsIterator.hasNext()) {

      var videoAd = videoAdsIterator.next()

      videoAd.pause()
      videoAd.isPaused()

      Logger.log('Paused videoAd %s', videoAd.getName())
    }
  },
  getAdGroupTypeWithPrefix(adGroupType) {
    const validAdGroupTypes = [
      "TRUE_VIEW_IN_STREAM",
      "NON_SKIPPABLE_IN_STREAM",
      "RESPONSIVE",
      "EFFICIENT_REACH",
      "SKIPPABLE_IN_STREAM",
      "TRUE_VIEW_IN_DISPLAY",
      "BUMPER"
    ];

    // Add "VIDEO_" prefix if necessary
    if (validAdGroupTypes.includes(adGroupType)) {
      return "VIDEO_" + adGroupType;
    }

    // Return original adGroupType if already correctly prefixed
    return adGroupType;
  },
  logSupportedAdGroupTypes(campaign) {
    try {
      Logger.log('Checking supported ad group types for campaign: ' + campaign.getName());

      var adGroupTypes = [
        'VIDEO_TRUE_VIEW_IN_STREAM',
        'VIDEO_NON_SKIPPABLE_IN_STREAM',
        'VIDEO_SKIPPABLE_IN_STREAM',
        'VIDEO_RESPONSIVE',
        'VIDEO_EFFICIENT_REACH',
        'VIDEO_TRUE_VIEW_IN_DISPLAY',
        'VIDEO_BUMPER'
      ];

      adGroupTypes.forEach(function (type) {
        try {
          Logger.log('Testing ad group type: ' + type);

          // Following the real ad group creation steps
          var testAdGroup = campaign.newVideoAdGroupBuilder()
            .withName('Test-' + type)
            .withAdGroupType(type)
            .build()
            .getResult();


          if (testAdGroup !== null) {
            Logger.log('Supported ad group type: ' + type);

            // Pause the Ad Group
            try {
              testAdGroup.pause();
              testAdGroup.status("REMOVED")
              Logger.log('Successfully paused test ad group: ' + testAdGroup.getName());
            } catch (error) {
              Logger.log('Error pausing ad group: ' + error.message);
            }
          } else {
            Logger.log('Ad group creation for type ' + type + ' was not successful.');
          }

        } catch (e) {
          Logger.log('Ad group type ' + type + ' is not supported or could not be created. Error: ' + e.message);
        }
      });
    } catch (e) {
      Logger.log('Failed to check supported ad group types. Error: ' + e.message);
    }
  },

  createOrRetrieveVideoAdGroup(campaignName, AdGroupType, adGroupName) {
    // Ensure the ad group type has the correct prefix
    AdGroupType = this.getAdGroupTypeWithPrefix(AdGroupType);

    var adGroup = this.findVideoAdGroup(adGroupName, campaignName);

    if (adGroup) {
      adGroup.enable();
      adGroup.isEnabled();
      Logger.log('AdGroup %s already exists with type %s', adGroup.getName(), adGroup.getAdGroupType());
    } else {
      try {
        Logger.log('AdGroupName: %s, AdGroupType %s, campaignName %s', adGroupName, AdGroupType, campaignName);
        var videoCampaign = AdsApp.videoCampaigns()
          .withCondition('Name = "' + campaignName + '"')
          .get()
          .next();
        Logger.log('videoCampaign %s', videoCampaign.getName());

        Logger.log('Attempting to build ad group...');
        adGroup = videoCampaign.newVideoAdGroupBuilder()
          .withName(adGroupName)
          .withAdGroupType(AdGroupType)
          .build()
          .getResult();

        if (adGroup === null) {
          throw new Error('Ad group creation returned null.');
        }

        Logger.log('AdGroup created: %s with type %s', adGroup.getName(), adGroup.getAdGroupType());
      } catch (e) {
        Logger.log('Failed to create AdGroup %s with type %s in campaign %s. Error: %s', adGroupName, AdGroupType, campaignName, e.message);
        Logger.log('Stack trace: %s', e.stack);
      }


    }

    return adGroup;
  },

  createOrRetrieveAdGroup: function (campaignName, adGroupName) {
    var adGroup = this.findAdGroup(adGroupName, campaignName)
    // Already existing adGroup
    if (adGroup) {
      adGroup.enable()
      adGroup.isEnabled()
      Logger.log('AdGroup %s already exists', adGroup.getName())
    } else {
      // New adGroup
      var campaign = AdsApp.campaigns()
        .withCondition('Name = "' + campaignName + '"')
        .get()
        .next()
      adGroup = campaign.newAdGroupBuilder()
        .withName(adGroupName)
        .build()
        .getResult()
      Logger.log('AdGroup %s created', adGroup.getName())
    }
    return adGroup
  },

  createOrReactivateVideoAd(adName, adGroup, videoId, url, callToAction) {
    Logger.log('Attempting to create or reactivate video ad: ' + (adName || 'New Ad'));

    // Create asset for YouTube Video
    let assetOperation = AdsApp.adAssets().newYouTubeVideoAssetBuilder()
      .withName(adName)
      .withYouTubeVideoId(videoId)
      .build();
    let videoAsset = assetOperation.getResult();
    Logger.log('Created video asset ID: ' + videoAsset.getId());

    var videoAd = this.findVideoAd(adName, adGroup);
    if (videoAd) {
      Logger.log('Existing video ad found: ' + videoAd.getName());
      videoAd.enable();
      Logger.log('Enabled existing video ad: ' + videoAd.getName());
      return videoAd;
    }

    Logger.log('Creating new video ad since no existing ad matched.');
    Logger.log('Ad Group Type: ' + adGroup.getAdGroupType());
    Logger.log('Ad Name: ' + adName);
    Logger.log('Video ID: ' + videoId);
    Logger.log('URL: ' + url);
    Logger.log('Call to Action: ' + callToAction);

    try {
      switch (adGroup.getAdGroupType()) {
        case 'VIDEO_TRUE_VIEW_IN_STREAM':
          videoAd = adGroup.newVideoAd()
            .inStreamAdBuilder()
            .withAdName(adName)
            .withVideo(videoAsset)
            .withFinalUrl(url)
            .withDisplayUrl(url)
            .withCallToAction(callToAction)
            .build();
          break;
        case 'VIDEO_NON_SKIPPABLE_IN_STREAM':
          videoAd = adGroup.newVideoAd()
              .nonSkippableAdBuilder()
              .withAdName(adName)
              .withVideo(videoAsset)
              .withFinalUrl(url)
              .withDisplayUrl(url)
              //.withCallToAction(callToAction)
              .build();
          break;
        case 'VIDEO_SKIPPABLE_IN_STREAM':
          videoAd = adGroup.newVideoAd()
            .inStreamAdBuilder()
            .withAdName(adName)
            .withVideo(videoAsset)
            .withFinalUrl(url)
            .withDisplayUrl(url)
            .withCallToAction(callToAction)
            .build();
          break;
        case 'VIDEO_TRUE_VIEW_IN_DISPLAY':
          videoAd = adGroup.newVideoAd()
            .videoDiscoveryAdBuilder()
            .withAdName(adName)
            .withVideo(videoAsset)
            .withDescription1('Description 1')
            .withDescription2('Description 2')
            .withHeadline('Headline')
            .withDestinationPage("WATCH")
            .withThumbnail('DEFAULT')
            .build();
          break;
        case 'VIDEO_BUMPER':
          videoAd = adGroup.newVideoAd()
            .bumperAdBuilder()
            .withAdName(adName)
            .withVideo(videoAsset)
            .withFinalUrl(url)
            .withDisplayUrl(url)
            .build();
          break;
        default:
          Logger.log('Unknown ad group type: ' + adGroup.getAdGroupType());
          return null;
      }

      // Check if videoAd was created successfully
      if (videoAd && videoAd.isSuccessful()) {
        Logger.log('Video ad created successfully.');
        return videoAd;
      } else {
        Logger.log('Failed to create video ad. Possible errors: ' + videoAd.getErrors());
        return null;
      }

    } catch (e) {
      Logger.log('Error during video ad creation: ' + e.message);
      return null;
    }
  },

  createOrReactivateAd: function (adName, adGroup, imageId, url) {

    // First, check if it already exists
    var ad = this.findAd(adName, adGroup)

    if (ad) {

      ad.enable()
      ad.isEnabled()

      Logger.log('Existing ad %s changed to ENABLED', ad.getName())

      return ad
    }

    // Else, let's create new ad
    var imageBlob = DriveApp.getFileById(imageId).getBlob()

    var imageMedia = AdsApp.video()
      .newImageBuilder()
      .withName(imageId)
      .withData(imageBlob)
      .build()
      .getResult()

    if (imageMedia == null) {
      Logger.log('Problem linking image %s - please verify!', imageId)
      return null
    }

    ad = adGroup.newAd().imageAdBuilder()
      .withName(adName)
      .withImage(imageMedia)
      .withDisplayUrl(url)
      .withFinalUrl(url)
      .build()
      .getResult()

    return ad
  },

  associateAudienceWithAdGroup: function (adGroup, audienceNames, audienceAssociator) {
    if (audienceNames === null || audienceNames === '') {
      Logger.log('Row without audience')
      return
    }

    audienceNames.split(',').forEach(function (originalAudienceName) {
      audienceName = originalAudienceName.trim()

      userListIterator = AdsApp.userlists().withCondition("Name = '" + audienceName + "'").get()

      if (!userListIterator.hasNext()) {
        Logger.log('Could not find audience ' + audienceName)
        return
      }

      if (userListIterator.totalNumEntities() > 1) {
        Logger.log('More than one audience found for name ' + audienceName)
        while (userListIterator.hasNext()) {
          Logger.log('Audience found: ' + userListIterator.next().getName())
        }
        return
      }

      audienceOperation = audienceAssociator(adGroup, userListIterator.next().getId())

      var audienceResultSuccessful = audienceOperation.isSuccessful();
      if (audienceResultSuccessful) {
        Logger.log('AdGroup ' + adGroup.getName() + ' linked to audience ' + audienceName)
      } else {
        Logger.log('Could not link adGroup ' + adGroup.getName() + ' to audience ' + audienceName)
      }
    })
  },

  videoAdAudienceAssociator: function (adGroup, audienceId) {
    return adGroup
      .videoTargeting()
      .newAudienceBuilder()
      .withAudienceType("USER_LIST")
      .withAudienceId(audienceId)
      .build();
  },

  adAudienceAssociator: function (adGroup, audienceId) {
    return adGroup.targeting()
      .newUserListBuilder()
      .withAudienceId(audienceId)
      .build();
  }
}