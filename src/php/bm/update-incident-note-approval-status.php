<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$noteID = $params['noteID'];
	$approvalStatus = $params['approvalStatus'];
	$userID = get_current_user_id();
	$isEditor = current_user_can('editor');
	$isAdmin = current_user_can('administrator');
	
	// Only update the note status if the user is an editor or admin
	if ($isEditor || $isAdmin)
	{
		$wpdb->query($wpdb->prepare("CALL update_incident_note_approval_status(%d, %d, %d)", $noteID, $userID, $approvalStatus));
		
		// Update approval status in the ES record
		$indexName = 'avw_incident_notes';
		$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
		$postData = array(
			'script' => array(
				'inline' => "ctx._source.Approval_Status=$approvalStatus; ctx._source.Approval_Status_Changed='$currentDateTime'; ctx._source.Approval_Status_Changed_By=$userID",
				'lang' => 'groovy'
			)
		);

		$result = apiIndexUpdate($indexName, 'incident_note', $noteID, $postData);
		
		echo 1;
	}
	else
	{
		echo 0;
	}
?>
