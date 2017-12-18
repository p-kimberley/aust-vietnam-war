<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>
<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$incidentID = $params["incidentID"];
	$casType = urldecode($params["casType"]);
	$casData = urldecode($params["casData"]);
	$comment = urldecode($params["comment"]);
	$currentUser = get_current_user_id();
	
	if ($currentUser != 0)
	{
		$serviceNumbers = explode(",", $casData);
		
		foreach ($serviceNumbers as $serviceNo)
		{
			// Casualty service number, incident ID, casualty type, comment, user ID
			$wpdb->query($wpdb->prepare("CALL record_casualty_incident_info(%s, %d, %s, %s, %d)", $serviceNo, $incidentID, $casType, $comment, $currentUser));
		}
	}
	else
	{
		echo 0;
	}
	
	echo 1;
?>