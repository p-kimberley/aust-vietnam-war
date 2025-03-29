<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$mediaItemIDs = explode(',', $params['mediaItemIDs']);
	$approvalStatus = $params['approvalStatus'];
	$userID = get_current_user_id();
	$isEditor = current_user_can('editor');
	$isAdmin = current_user_can('administrator');
	
	// Only update the media item status if the user is an editor or admin
	if ($isEditor || $isAdmin)
	{
		foreach ($mediaItemIDs as $mediaItemID)
		{
			$wpdb->query($wpdb->prepare("CALL update_media_approval_status(%d, %d, %d)", intval($mediaItemID), $userID, $approvalStatus));
			
			// Update approval status in the ES record
			$indexName = 'avw_incident_media';
			$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
			$postData = array(
				'script' => array(
					'inline' => "ctx._source.Approval_Status=$approvalStatus; ctx._source.Approval_Status_Changed='$currentDateTime'; ctx._source.Approval_Status_Changed_By=$userID",
					'lang' => 'groovy'
				)
			);

			$result = apiIndexUpdate($indexName, 'incident_media', $mediaItemID, $postData);
		}
		
		echo 1;
	}
	else
	{
		echo 0;
	}
?>
