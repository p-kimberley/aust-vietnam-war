<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>
<?php
	$mediaID = $_POST['mediaID'];
	
	// Increments the number of views a media record has had
	$wpdb->query($wpdb->prepare("CALL record_user_media_like(%d, %d)", $mediaID, $current_user->ID));
	
	// Post the record to the ES index
	$indexName = 'avw_incident_media';
	$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
	$postData = array(
		'script' => array(
			'inline' => 'ctx._source.Likes.add(like)',
			'lang' => 'groovy',
			'params' => array(
				'like' => array(
					'User' => array(
						'ID' => $current_user->ID,
						'Login' => $current_user->user_login,
						'Name' => $current_user->display_name
					),
					'Timestamp' => $currentDateTime
				)
			)
		)
	);

	$result = apiIndexUpdate($indexName, 'incident_media', $mediaID, $postData);
	
	echo 1;
?>