<?php
/*
 * Plugin Name: AVW Homepage News
 * Description: Displays most recent news items, including their excerpts
 * Version: 1.0
 * Author: Gradata Systems Pty Ltd
 * Author URI: http://gradata.com.au
 */

class AVW_Homepage_News extends WP_Widget
{
    /**
     * Sets up the widgets name etc
     */
    public function __construct()
    {
        parent::__construct(
            'avw_homepage_news',
            'AVW Homepage News',
            array(
                    'description' => 'Displays most recent news items, including their excerpts'
            )
        );
    }

    /**
     * Outputs the content of the widget
     *
     * @param array $args
     * @param array $instance
     */
    public function widget($args, $instance)
    {
        $title = $instance['title'];
        ?>
        <div class="avw-homepage-widget news ' . $this->id_base . '">
        <div class="news-container">
        <h2>Latest News</h2>
        <?php

        $args = array(
            'tax_query' => array(
                'terms' => 'news'
            ),
            'numberposts' => 3
        );

        $posts = get_posts($args);
        echo '<ul>';
        foreach($posts as &$post)
        {
            ?>
            <li>
                <div class="date"><?php echo $this->format_date($post->post_date);?></div>
                <div class="title"><a href="<?php echo get_permalink($post->ID);?>"><?php echo $post->post_title;?></a></div>
            </li>
            <?php
        }
        echo '</ul>';
        echo '</div></div>';
    }

    private function format_date($date_str)
    {
        $date = new DateTime($date_str);
        return $date->format("j F Y");
    }

    /**
     * Outputs the options form on admin
     *
     * @param array $instance The widget options
     */
    public function form($instance)
    {
        $title = !empty($instance['title']) ? $instance['title'] : esc_html('New title');
        $field_id = $this->get_field_id('title');
        $field_name = $this->get_field_name('title');
        ?>
        <p>
            <label for="<?php echo esc_attr($field_id); ?>"><?php esc_attr_e('Title:'); ?></label>
            <input type="text" class="widefat" id="<?php echo esc_attr($field_id); ?>"
                   name="<?php echo esc_attr($field_name); ?>"
                   value="<?php echo esc_attr($title); ?>">
        </p>
        <?php
    }

    /**
     * Processing widget options on save
     *
     * @param array $new_instance The new options
     * @param array $old_instance The previous options
     */
    public function update($new_instance, $old_instance)
    {
        $instance = array();
        $new_title = $new_instance['title'];
        $instance['title'] = (!empty($new_title) ? strip_tags($new_title) : '');

        return $instance;
    }
}

add_action('widgets_init', function() {
    register_widget('AVW_Homepage_News');
});